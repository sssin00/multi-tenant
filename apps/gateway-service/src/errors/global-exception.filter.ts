import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus
} from "@nestjs/common";
import type { Response } from "express";

import type { GatewayRequest } from "../context/request-context.js";

interface GatewayErrorBody {
  code?: string;
  message?: string;
  details?: unknown;
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const req = http.getRequest<GatewayRequest>();
    const res = http.getResponse<Response>();
    const statusCode = this.getStatusCode(exception);
    this.logError(exception, req, statusCode);

    if (exception instanceof HttpException) {
      const response = exception.getResponse();
      if (this.isReadinessResponse(response)) {
        res.status(statusCode).json(response);
        return;
      }
    }

    const errorBody = this.getErrorBody(exception, statusCode);

    res.status(statusCode).json({
      success: false,
      requestId: req.context?.requestId,
      timestamp: new Date().toISOString(),
      error: {
        code: errorBody.code,
        message: errorBody.message,
        details: errorBody.details ?? {}
      }
    });
  }

  private getStatusCode(exception: unknown): number {
    if (exception instanceof HttpException) {
      return exception.getStatus();
    }

    return HttpStatus.INTERNAL_SERVER_ERROR;
  }

  private getErrorBody(exception: unknown, statusCode: number): Required<GatewayErrorBody> {
    if (exception instanceof HttpException) {
      const response = exception.getResponse();
      if (typeof response === "object" && response !== null) {
        const body = response as GatewayErrorBody;
        return {
          code: body.code ?? this.defaultCode(statusCode),
          message: body.message ?? exception.message,
          details: body.details ?? {}
        };
      }

      return {
        code: this.defaultCode(statusCode),
        message: typeof response === "string" ? response : exception.message,
        details: {}
      };
    }

    return {
      code: "INTERNAL_SERVER_ERROR",
      message: "Internal server error",
      details: {}
    };
  }

  private isReadinessResponse(response: unknown): boolean {
    if (typeof response !== "object" || response === null) {
      return false;
    }

    const body = response as { status?: unknown; service?: unknown; checks?: unknown };
    return body.status === "not_ready" && typeof body.service === "string" && typeof body.checks === "object";
  }

  private logError(exception: unknown, req: GatewayRequest, statusCode: number) {
    const response = exception instanceof HttpException ? exception.getResponse() : undefined;
    const errorCode =
      typeof response === "object" && response !== null && "code" in response
        ? String((response as { code?: unknown }).code)
        : this.defaultCode(statusCode);
    const message = exception instanceof Error ? exception.message : "Unhandled exception";

    console.error(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "error",
        service: "gateway-service",
        requestId: req.context?.requestId,
        tenantId: req.context?.tenantId,
        userId: req.context?.userId,
        errorCode,
        method: req.method,
        path: req.path,
        statusCode,
        message
      })
    );
  }

  private defaultCode(statusCode: number): string {
    switch (statusCode) {
      case HttpStatus.BAD_REQUEST:
        return "INVALID_REQUEST";
      case HttpStatus.UNAUTHORIZED:
        return "UNAUTHORIZED";
      case HttpStatus.FORBIDDEN:
        return "FORBIDDEN";
      case HttpStatus.NOT_FOUND:
        return "NOT_FOUND";
      case HttpStatus.CONFLICT:
        return "CONFLICT";
      case HttpStatus.UNPROCESSABLE_ENTITY:
        return "BUSINESS_RULE_VIOLATION";
      case HttpStatus.TOO_MANY_REQUESTS:
        return "RATE_LIMIT_EXCEEDED";
      case HttpStatus.SERVICE_UNAVAILABLE:
        return "SERVICE_UNAVAILABLE";
      default:
        return "INTERNAL_SERVER_ERROR";
    }
  }
}

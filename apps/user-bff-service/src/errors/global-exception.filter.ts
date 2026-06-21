import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger
} from "@nestjs/common";
import type { Response } from "express";
import type { RequestWithContext } from "../context/request-context.js";

interface ErrorEnvelope {
  success: false;
  requestId: string;
  timestamp: string;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<RequestWithContext>();
    const requestId = request.context?.requestId ?? "unknown";
    const tenantId = request.context?.tenantId;
    const userId = request.context?.userId;

    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const payload = this.normalizeError(exception, status, requestId);

    this.logger.error(
      JSON.stringify({
        timestamp: payload.timestamp,
        level: "error",
        service: "user-bff-service",
        requestId,
        tenantId,
        userId,
        method: request.method,
        path: request.originalUrl ?? request.url,
        statusCode: status,
        errorCode: payload.error.code,
        message: payload.error.message
      })
    );

    response.status(status).json(payload);
  }

  private normalizeError(exception: unknown, status: number, requestId: string): ErrorEnvelope {
    if (exception instanceof HttpException) {
      const response = exception.getResponse();
      if (typeof response === "object" && response !== null && "error" in response) {
        const body = response as Partial<ErrorEnvelope>;
        return {
          success: false,
          requestId,
          timestamp: new Date().toISOString(),
          error: {
            code: body.error?.code ?? this.defaultCode(status),
            message: body.error?.message ?? exception.message,
            ...(body.error?.details ? { details: body.error.details } : {})
          }
        };
      }

      return {
        success: false,
        requestId,
        timestamp: new Date().toISOString(),
        error: {
          code: this.defaultCode(status),
          message: exception.message
        }
      };
    }

    return {
      success: false,
      requestId,
      timestamp: new Date().toISOString(),
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "Internal server error"
      }
    };
  }

  private defaultCode(status: number): string {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return "VALIDATION_FAILED";
      case HttpStatus.UNAUTHORIZED:
        return "UNAUTHORIZED";
      case HttpStatus.FORBIDDEN:
        return "FORBIDDEN";
      case HttpStatus.NOT_FOUND:
        return "NOT_FOUND";
      case HttpStatus.CONFLICT:
        return "CONFLICT";
      case HttpStatus.SERVICE_UNAVAILABLE:
        return "SERVICE_UNAVAILABLE";
      default:
        return "INTERNAL_SERVER_ERROR";
    }
  }
}

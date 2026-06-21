import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { loadAppConfig } from "../config/app.config.js";
import type { RequestContext } from "../context/request-context.js";
import { InternalAuthSignerService } from "./internal-auth-signer.service.js";

type InternalAuthTarget = "authIam" | "tenant" | "wms" | "audit";
type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

interface RequestInput {
  target: InternalAuthTarget;
  baseUrl: string;
  method: HttpMethod;
  path: string;
  context: RequestContext;
  body?: unknown;
  idempotencyKey?: string;
}

interface ApiEnvelope<T> {
  success?: boolean;
  requestId?: string;
  timestamp?: string;
  data?: T;
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
}

@Injectable()
export class InternalHttpClient {
  private readonly config = loadAppConfig();

  constructor(private readonly signer: InternalAuthSignerService) {}

  async request<T>(input: RequestInput): Promise<T> {
    const url = this.buildUrl(input.baseUrl, input.path);
    const maxAttempts = this.maxAttempts(input.method);
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await this.send<T>(input, url);
      } catch (error) {
        lastError = error;
        if (!this.shouldRetry(input.method, error, attempt, maxAttempts)) {
          throw error;
        }
      }
    }

    throw lastError;
  }

  private async send<T>(input: RequestInput, url: URL): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.downstream.timeoutMs);

    try {
      const body = input.body === undefined ? undefined : JSON.stringify(input.body);
      const headers = this.buildHeaders(input, url, body);
      const response = await fetch(url, {
        method: input.method,
        headers,
        body,
        signal: controller.signal
      });

      const envelope = (await this.readJson<ApiEnvelope<T>>(response)) ?? {};

      if (!response.ok || envelope.success === false) {
        throw new HttpException(
          {
            success: false,
            requestId: input.context.requestId,
            timestamp: new Date().toISOString(),
            error: {
              code: envelope.error?.code ?? this.defaultErrorCode(response.status),
              message: envelope.error?.message ?? "Downstream service request failed",
              ...(envelope.error?.details ? { details: envelope.error.details } : {})
            }
          },
          this.mapStatus(response.status)
        );
      }

      return envelope.data as T;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        {
          success: false,
          requestId: input.context.requestId,
          timestamp: new Date().toISOString(),
          error: {
            code: "DOWNSTREAM_UNAVAILABLE",
            message: "Downstream service is unavailable"
          }
        },
        HttpStatus.SERVICE_UNAVAILABLE
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private buildHeaders(input: RequestInput, url: URL, body?: string): HeadersInit {
    const pathForSignature = this.signaturePath(url);
    const internalAuthHeaders = this.config.internalAuth.enabled
      ? this.signer.sign({
          method: input.method,
          path: pathForSignature,
          requestId: input.context.requestId,
          body: body ? JSON.parse(body) : undefined,
          secret: this.secretFor(input.target)
        })
      : {};

    return {
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
      "X-Request-Id": input.context.requestId,
      ...(input.context.tenantId ? { "X-Tenant-Id": input.context.tenantId } : {}),
      ...(input.context.userId ? { "X-User-Id": input.context.userId } : {}),
      ...(input.context.authorization ? { Authorization: input.context.authorization } : {}),
      ...(input.idempotencyKey ? { "Idempotency-Key": input.idempotencyKey } : {}),
      ...internalAuthHeaders
    };
  }

  private async readJson<T>(response: Response): Promise<T | null> {
    const text = await response.text();
    if (!text) {
      return null;
    }

    try {
      return JSON.parse(text) as T;
    } catch {
      return null;
    }
  }

  private buildUrl(baseUrl: string, path: string): URL {
    const trimmedBase = baseUrl.replace(/\/$/, "");
    const trimmedPath = path.startsWith("/") ? path : `/${path}`;
    return new URL(`${trimmedBase}${trimmedPath}`);
  }

  private signaturePath(url: URL): string {
    return `${url.pathname}${url.search}`;
  }

  private secretFor(target: InternalAuthTarget): string {
    switch (target) {
      case "authIam":
        return this.config.internalAuth.authSecret;
      case "tenant":
        return this.config.internalAuth.tenantSecret;
      case "wms":
        return this.config.internalAuth.wmsSecret;
      case "audit":
        return this.config.internalAuth.auditSecret;
    }
  }

  private maxAttempts(method: HttpMethod): number {
    if (method !== "GET") {
      return 1;
    }

    return Math.max(1, this.config.downstream.safeMethodRetries + 1);
  }

  private shouldRetry(method: HttpMethod, error: unknown, attempt: number, maxAttempts: number): boolean {
    if (method !== "GET" || attempt >= maxAttempts) {
      return false;
    }

    if (!(error instanceof HttpException)) {
      return true;
    }

    return [HttpStatus.BAD_GATEWAY, HttpStatus.SERVICE_UNAVAILABLE, HttpStatus.GATEWAY_TIMEOUT].includes(
      error.getStatus()
    );
  }

  private mapStatus(status: number): number {
    if (status >= 400 && status < 600) {
      return status;
    }

    return HttpStatus.SERVICE_UNAVAILABLE;
  }

  private defaultErrorCode(status: number): string {
    switch (status) {
      case HttpStatus.UNAUTHORIZED:
        return "UNAUTHORIZED";
      case HttpStatus.FORBIDDEN:
        return "FORBIDDEN";
      case HttpStatus.NOT_FOUND:
        return "NOT_FOUND";
      case HttpStatus.CONFLICT:
        return "CONFLICT";
      case HttpStatus.SERVICE_UNAVAILABLE:
        return "DOWNSTREAM_UNAVAILABLE";
      default:
        return "DOWNSTREAM_REQUEST_FAILED";
    }
  }
}

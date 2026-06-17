import { HttpException, Injectable, ServiceUnavailableException } from "@nestjs/common";

import { getAppConfig } from "../config/app.config.js";
import { InternalAuthSignerService } from "./internal-auth-signer.service.js";

export interface AuditLogClientContext {
  requestId: string;
  tenantId?: string;
  userId?: string;
}

export interface AuditLogListResponse {
  items: AuditLogListItem[];
  page: number;
  size: number;
  total: number;
}

export interface AuditLogListItem {
  auditId: string;
  occurredAt: string;
  tenantId: string;
  actor: {
    type: string;
    userId?: string | null;
    serviceId?: string | null;
  };
  action: string;
  resource: {
    type: string;
    id: string | null;
  };
  result: string;
  requestId: string;
  reason?: string | null;
  details?: unknown;
  createdAt?: string;
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

const SAFE_RETRY_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const RETRYABLE_STATUS_CODES = new Set([502, 503, 504]);

@Injectable()
export class AuditLogInternalClient {
  private readonly config = getAppConfig();

  constructor(private readonly internalAuthSignerService: InternalAuthSignerService) {}

  async listAuditLogs(
    context: AuditLogClientContext,
    query: Record<string, unknown>
  ): Promise<AuditLogListResponse> {
    return this.request<AuditLogListResponse>({
      method: "GET",
      path: this.withQuery("/api/internal/audit/logs", query),
      ...context
    });
  }

  private async request<T>(command: {
    method: string;
    path: string;
    requestId: string;
    tenantId?: string;
    userId?: string;
    body?: unknown;
  }): Promise<T> {
    const targetUrl = this.buildUrl(command.path);
    const originalUrl = `${targetUrl.pathname}${targetUrl.search}`;
    const headers = this.buildHeaders(command, originalUrl);
    const response = await this.fetchWithPolicy(targetUrl, command, headers);
    const envelope = await this.readEnvelope<T>(response);

    if (!response.ok || envelope.success === false) {
      this.throwUpstreamError(response, envelope);
    }

    if (envelope.data === undefined) {
      throw new ServiceUnavailableException({
        code: "UPSTREAM_INVALID_RESPONSE",
        message: "Audit log service response does not include data"
      });
    }

    return envelope.data;
  }

  private async fetchWithPolicy(
    targetUrl: URL,
    command: {
      method: string;
      body?: unknown;
    },
    headers: Headers
  ): Promise<globalThis.Response> {
    const maxAttempts = this.canRetry(command.method) ? this.config.downstream.retryCount + 1 : 1;
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const response = await this.fetchOnce(targetUrl, command, headers);
        if (this.shouldRetryResponse(command.method, attempt, response.status)) {
          await response.body?.cancel();
          continue;
        }

        return response;
      } catch (error) {
        lastError = error;
        if (!this.shouldRetryError(command.method, attempt)) {
          break;
        }
      }
    }

    if (lastError instanceof UpstreamTimeoutError) {
      throw new ServiceUnavailableException({
        code: "UPSTREAM_TIMEOUT",
        message: "Audit log service request timed out",
        details: {
          upstream: "audit-log-service",
          timeoutMs: this.config.downstream.timeoutMs
        }
      });
    }

    throw new ServiceUnavailableException({
      code: "UPSTREAM_UNAVAILABLE",
      message: "Audit log service unavailable",
      details: {
        upstream: "audit-log-service"
      }
    });
  }

  private async fetchOnce(
    targetUrl: URL,
    command: {
      method: string;
      body?: unknown;
    },
    headers: Headers
  ): Promise<globalThis.Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.downstream.timeoutMs);

    try {
      return await fetch(targetUrl, {
        method: command.method,
        headers,
        body: command.body === undefined ? undefined : JSON.stringify(command.body),
        signal: controller.signal
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new UpstreamTimeoutError();
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private buildHeaders(
    command: {
      method: string;
      requestId: string;
      tenantId?: string;
      userId?: string;
      body?: unknown;
    },
    originalUrl: string
  ): Headers {
    if (this.config.internalAuth.enabled && !this.config.internalAuth.auditLogSecret) {
      throw new ServiceUnavailableException({
        code: "AUDIT_LOG_INTERNAL_AUTH_NOT_READY",
        message: "Audit log internal auth secret is not configured"
      });
    }

    const headers = new Headers({
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Request-Id": command.requestId
    });

    if (command.tenantId) {
      headers.set("X-Tenant-Id", command.tenantId);
    }

    if (command.userId) {
      headers.set("X-User-Id", command.userId);
    }

    const internalAuthHeaders = this.internalAuthSignerService.sign({
      target: "audit-log-service",
      method: command.method,
      originalUrl,
      requestId: command.requestId,
      body: command.body
    });

    for (const [name, value] of Object.entries(internalAuthHeaders)) {
      headers.set(name, value);
    }

    return headers;
  }

  private buildUrl(path: string): URL {
    if (!this.config.downstream.auditLogServiceUrl) {
      throw new ServiceUnavailableException({
        code: "AUDIT_LOG_SERVICE_NOT_CONFIGURED",
        message: "Audit log service URL is not configured"
      });
    }

    const baseUrl = new URL(this.config.downstream.auditLogServiceUrl);
    const pathUrl = new URL(path, "http://admin-bff.local");
    const normalizedBasePath = baseUrl.pathname.endsWith("/")
      ? baseUrl.pathname.slice(0, -1)
      : baseUrl.pathname;
    const normalizedPath = pathUrl.pathname.startsWith("/") ? pathUrl.pathname : `/${pathUrl.pathname}`;

    if (normalizedBasePath === "" || normalizedBasePath === "/") {
      baseUrl.pathname = normalizedPath;
    } else if (normalizedPath.startsWith(normalizedBasePath)) {
      baseUrl.pathname = normalizedPath;
    } else {
      baseUrl.pathname = `${normalizedBasePath}${normalizedPath}`;
    }
    baseUrl.search = pathUrl.search;
    return baseUrl;
  }

  private withQuery(path: string, query: Record<string, unknown>): string {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        searchParams.set(key, String(value));
      } else if (Array.isArray(value) && value.length > 0) {
        searchParams.set(key, String(value[0]));
      }
    }

    const queryString = searchParams.toString();
    return queryString ? `${path}?${queryString}` : path;
  }

  private async readEnvelope<T>(response: globalThis.Response): Promise<ApiEnvelope<T>> {
    const text = await response.text();
    if (!text) {
      return {};
    }

    try {
      return JSON.parse(text) as ApiEnvelope<T>;
    } catch {
      throw new ServiceUnavailableException({
        code: "UPSTREAM_INVALID_RESPONSE",
        message: "Audit log service returned non-JSON response"
      });
    }
  }

  private throwUpstreamError(response: globalThis.Response, envelope: ApiEnvelope<unknown>): never {
    throw new HttpException(
      {
        code: envelope.error?.code ?? "UPSTREAM_ERROR",
        message: envelope.error?.message ?? "Audit log service request failed",
        details: envelope.error?.details
      },
      response.status
    );
  }

  private canRetry(method: string): boolean {
    return SAFE_RETRY_METHODS.has(method.toUpperCase());
  }

  private shouldRetryResponse(method: string, attempt: number, statusCode: number): boolean {
    return this.canRetry(method) && attempt <= this.config.downstream.retryCount && RETRYABLE_STATUS_CODES.has(statusCode);
  }

  private shouldRetryError(method: string, attempt: number): boolean {
    return this.canRetry(method) && attempt <= this.config.downstream.retryCount;
  }
}

class UpstreamTimeoutError extends Error {}

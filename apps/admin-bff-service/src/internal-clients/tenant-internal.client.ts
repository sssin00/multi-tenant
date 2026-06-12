import { HttpException, Injectable, ServiceUnavailableException } from "@nestjs/common";

import { getAppConfig } from "../config/app.config.js";
import { InternalAuthSignerService } from "./internal-auth-signer.service.js";

export interface TenantClientContext {
  requestId: string;
  tenantId?: string;
  userId?: string;
  idempotencyKey?: string;
}

export interface TenantResponse {
  tenantId: string;
  code: string;
  name: string;
  status: string;
  dbStrategy: string;
  createdAt: string;
  updatedAt: string;
}

export interface TenantModulesResponse {
  tenantId: string;
  status: string;
  enabledModules: string[];
}

export interface TenantListResponse {
  items: TenantListItem[];
  page: number;
  size: number;
  total: number;
}

export interface TenantListItem {
  tenantId: string;
  code: string;
  name: string;
  status: string;
  domains?: string[];
  enabledModules?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface TenantDetailResponse extends TenantResponse {
  domains?: TenantDomainResponse[];
  enabledModules?: string[];
  settings?: Record<string, unknown>;
}

export interface TenantDomainResponse {
  domainId: string;
  tenantId: string;
  domain: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface TenantDomainListResponse {
  items: TenantDomainResponse[];
}

export interface ReplaceTenantModulesResponse {
  tenantId: string;
  enabledModules: string[];
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
export class TenantInternalClient {
  private readonly config = getAppConfig();

  constructor(private readonly internalAuthSignerService: InternalAuthSignerService) {}

  async getTenantModules(context: TenantClientContext, tenantId: string): Promise<TenantModulesResponse> {
    return this.request<TenantModulesResponse>({
      method: "GET",
      path: `/internal/tenants/${encodeURIComponent(tenantId)}/modules`,
      ...context
    });
  }

  async createTenant(context: TenantClientContext, body: unknown): Promise<TenantResponse> {
    return this.request<TenantResponse>({
      method: "POST",
      path: "/internal/admin/tenants",
      ...context,
      body
    });
  }

  async listTenants(
    context: TenantClientContext,
    query: Record<string, unknown>
  ): Promise<TenantListResponse> {
    return this.request<TenantListResponse>({
      method: "GET",
      path: this.withQuery("/internal/admin/tenants", query),
      ...context
    });
  }

  async getTenant(context: TenantClientContext, tenantId: string): Promise<TenantDetailResponse> {
    return this.request<TenantDetailResponse>({
      method: "GET",
      path: `/internal/admin/tenants/${encodeURIComponent(tenantId)}`,
      ...context
    });
  }

  async updateTenant(context: TenantClientContext, tenantId: string, body: unknown): Promise<TenantResponse> {
    return this.request<TenantResponse>({
      method: "PATCH",
      path: `/internal/admin/tenants/${encodeURIComponent(tenantId)}`,
      ...context,
      body
    });
  }

  async updateTenantStatus(context: TenantClientContext, tenantId: string, body: unknown): Promise<TenantResponse> {
    return this.request<TenantResponse>({
      method: "PATCH",
      path: `/internal/admin/tenants/${encodeURIComponent(tenantId)}/status`,
      ...context,
      body
    });
  }

  async replaceTenantModules(
    context: TenantClientContext,
    tenantId: string,
    body: unknown
  ): Promise<ReplaceTenantModulesResponse> {
    return this.request<ReplaceTenantModulesResponse>({
      method: "PUT",
      path: `/internal/admin/tenants/${encodeURIComponent(tenantId)}/modules`,
      ...context,
      body
    });
  }

  async listTenantDomains(context: TenantClientContext, tenantId: string): Promise<TenantDomainListResponse> {
    return this.request<TenantDomainListResponse>({
      method: "GET",
      path: `/internal/admin/tenants/${encodeURIComponent(tenantId)}/domains`,
      ...context
    });
  }

  async addTenantDomain(context: TenantClientContext, tenantId: string, body: unknown): Promise<TenantDomainResponse> {
    return this.request<TenantDomainResponse>({
      method: "POST",
      path: `/internal/admin/tenants/${encodeURIComponent(tenantId)}/domains`,
      ...context,
      body
    });
  }

  async deleteTenantDomain(
    context: TenantClientContext,
    tenantId: string,
    domainId: string
  ): Promise<{ deleted: boolean } | TenantDomainResponse> {
    return this.request<{ deleted: boolean } | TenantDomainResponse>({
      method: "DELETE",
      path: `/internal/admin/tenants/${encodeURIComponent(tenantId)}/domains/${encodeURIComponent(domainId)}`,
      ...context
    });
  }

  private async request<T>(command: {
    method: string;
    path: string;
    requestId: string;
    tenantId?: string;
    userId?: string;
    idempotencyKey?: string;
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
        message: "Tenant service response does not include data"
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
        message: "Tenant service request timed out",
        details: {
          upstream: "tenant-service",
          timeoutMs: this.config.downstream.timeoutMs
        }
      });
    }

    throw new ServiceUnavailableException({
      code: "UPSTREAM_UNAVAILABLE",
      message: "Tenant service unavailable",
      details: {
        upstream: "tenant-service"
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
      idempotencyKey?: string;
      body?: unknown;
    },
    originalUrl: string
  ): Headers {
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
    if (command.idempotencyKey) {
      headers.set("Idempotency-Key", command.idempotencyKey);
    }

    const internalAuthHeaders = this.internalAuthSignerService.sign({
      target: "tenant-service",
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
    const baseUrl = new URL(this.config.downstream.tenantServiceUrl);
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
    try {
      return (await response.json()) as ApiEnvelope<T>;
    } catch {
      return {
        success: false,
        error: {
          code: "UPSTREAM_INVALID_RESPONSE",
          message: "Tenant service response is not valid JSON"
        }
      };
    }
  }

  private throwUpstreamError(response: globalThis.Response, envelope: ApiEnvelope<unknown>): never {
    const statusCode = response.status >= 400 ? response.status : 502;
    throw new HttpException(
      {
        code: envelope.error?.code ?? "UPSTREAM_ERROR",
        message: envelope.error?.message ?? "Tenant service request failed",
        details: envelope.error?.details ?? {
          upstream: "tenant-service"
        }
      },
      statusCode
    );
  }

  private shouldRetryResponse(method: string, attempt: number, statusCode: number): boolean {
    return this.canRetry(method) && attempt <= this.config.downstream.retryCount && RETRYABLE_STATUS_CODES.has(statusCode);
  }

  private shouldRetryError(method: string, attempt: number): boolean {
    return this.canRetry(method) && attempt <= this.config.downstream.retryCount;
  }

  private canRetry(method: string): boolean {
    return SAFE_RETRY_METHODS.has(method.toUpperCase());
  }
}

class UpstreamTimeoutError extends Error {
  constructor() {
    super("Tenant service upstream timed out");
    this.name = "UpstreamTimeoutError";
  }
}

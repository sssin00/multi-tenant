import { HttpException, Injectable, ServiceUnavailableException } from "@nestjs/common";

import { getAppConfig } from "../config/app.config.js";
import { InternalAuthSignerService } from "./internal-auth-signer.service.js";

export interface PermissionCheckCommand {
  requestId: string;
  tenantId: string;
  userId: string;
  permission: string;
  scope?: {
    warehouseId?: string;
  };
}

export interface PermissionCheckResult {
  allowed: boolean;
  userId: string;
  tenantId: string;
  permission: string;
  scope: {
    warehouseId: string | null;
  };
}

export interface PermissionSummaryCommand {
  requestId: string;
  tenantId: string;
  userId: string;
}

export interface PermissionSummaryResult {
  userId: string;
  tenantId: string;
  roles: Array<{
    roleId: string;
    roleCode: string;
    warehouseId: string | null;
  }>;
  permissions: string[];
}

export interface AuthIamClientContext {
  requestId: string;
  tenantId: string;
  userId: string;
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

const SAFE_RETRY_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const RETRYABLE_STATUS_CODES = new Set([502, 503, 504]);

@Injectable()
export class AuthIamInternalClient {
  private readonly config = getAppConfig();

  constructor(private readonly internalAuthSignerService: InternalAuthSignerService) {}

  async checkPermission(command: PermissionCheckCommand): Promise<PermissionCheckResult> {
    const body = {
      userId: command.userId,
      permission: command.permission,
      scope: command.scope ?? {}
    };

    return this.request<PermissionCheckResult>({
      method: "POST",
      path: "/api/auth/permissions/check",
      requestId: command.requestId,
      tenantId: command.tenantId,
      userId: command.userId,
      body
    });
  }

  async getPermissionSummary(command: PermissionSummaryCommand): Promise<PermissionSummaryResult> {
    const searchParams = new URLSearchParams({
      userId: command.userId
    });

    return this.request<PermissionSummaryResult>({
      method: "GET",
      path: `/api/auth/permissions/summary?${searchParams.toString()}`,
      requestId: command.requestId,
      tenantId: command.tenantId,
      userId: command.userId
    });
  }

  async listUsers(context: AuthIamClientContext, query: Record<string, unknown>): Promise<unknown> {
    return this.request<unknown>({
      method: "GET",
      path: this.withQuery("/api/auth/users", query),
      ...context
    });
  }

  async createUser(context: AuthIamClientContext, body: unknown): Promise<unknown> {
    return this.request<unknown>({
      method: "POST",
      path: "/api/auth/users",
      ...context,
      body
    });
  }

  async getUser(context: AuthIamClientContext, userId: string): Promise<unknown> {
    return this.request<unknown>({
      method: "GET",
      path: `/api/auth/users/${encodeURIComponent(userId)}`,
      ...context
    });
  }

  async updateUser(context: AuthIamClientContext, userId: string, body: unknown): Promise<unknown> {
    return this.request<unknown>({
      method: "PATCH",
      path: `/api/auth/users/${encodeURIComponent(userId)}`,
      ...context,
      body
    });
  }

  async updateUserStatus(context: AuthIamClientContext, userId: string, body: unknown): Promise<unknown> {
    return this.request<unknown>({
      method: "PATCH",
      path: `/api/auth/users/${encodeURIComponent(userId)}/status`,
      ...context,
      body
    });
  }

  async deleteUser(context: AuthIamClientContext, userId: string): Promise<unknown> {
    return this.request<unknown>({
      method: "DELETE",
      path: `/api/auth/users/${encodeURIComponent(userId)}`,
      ...context
    });
  }

  async listPermissions(context: AuthIamClientContext, query: Record<string, unknown>): Promise<unknown> {
    return this.request<unknown>({
      method: "GET",
      path: this.withQuery("/api/auth/permissions", query),
      ...context
    });
  }

  async createPermission(context: AuthIamClientContext, body: unknown): Promise<unknown> {
    return this.request<unknown>({
      method: "POST",
      path: "/api/auth/permissions",
      ...context,
      body
    });
  }

  async getPermission(context: AuthIamClientContext, permissionId: string): Promise<unknown> {
    return this.request<unknown>({
      method: "GET",
      path: `/api/auth/permissions/${encodeURIComponent(permissionId)}`,
      ...context
    });
  }

  async listRoles(context: AuthIamClientContext, query: Record<string, unknown>): Promise<unknown> {
    return this.request<unknown>({
      method: "GET",
      path: this.withQuery("/api/auth/roles", query),
      ...context
    });
  }

  async createRole(context: AuthIamClientContext, body: unknown): Promise<unknown> {
    return this.request<unknown>({
      method: "POST",
      path: "/api/auth/roles",
      ...context,
      body
    });
  }

  async getRole(context: AuthIamClientContext, roleId: string): Promise<unknown> {
    return this.request<unknown>({
      method: "GET",
      path: `/api/auth/roles/${encodeURIComponent(roleId)}`,
      ...context
    });
  }

  async updateRole(context: AuthIamClientContext, roleId: string, body: unknown): Promise<unknown> {
    return this.request<unknown>({
      method: "PATCH",
      path: `/api/auth/roles/${encodeURIComponent(roleId)}`,
      ...context,
      body
    });
  }

  async replaceRolePermissions(context: AuthIamClientContext, roleId: string, body: unknown): Promise<unknown> {
    return this.request<unknown>({
      method: "PUT",
      path: `/api/auth/roles/${encodeURIComponent(roleId)}/permissions`,
      ...context,
      body
    });
  }

  async assignUserRole(context: AuthIamClientContext, userId: string, body: unknown): Promise<unknown> {
    return this.request<unknown>({
      method: "POST",
      path: `/api/auth/users/${encodeURIComponent(userId)}/roles`,
      ...context,
      body
    });
  }

  async listUserRoles(context: AuthIamClientContext, userId: string): Promise<unknown> {
    return this.request<unknown>({
      method: "GET",
      path: `/api/auth/users/${encodeURIComponent(userId)}/roles`,
      ...context
    });
  }

  async removeUserRole(context: AuthIamClientContext, userRoleId: string): Promise<unknown> {
    return this.request<unknown>({
      method: "DELETE",
      path: `/api/auth/user-roles/${encodeURIComponent(userRoleId)}`,
      ...context
    });
  }

  private async request<T>(command: {
    method: string;
    path: string;
    requestId: string;
    tenantId: string;
    userId: string;
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
        message: "Auth/IAM response does not include data"
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
        message: "Auth/IAM request timed out",
        details: {
          upstream: "auth-iam-service",
          timeoutMs: this.config.downstream.timeoutMs
        }
      });
    }

    throw new ServiceUnavailableException({
      code: "UPSTREAM_UNAVAILABLE",
      message: "Auth/IAM service unavailable",
      details: {
        upstream: "auth-iam-service"
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
      tenantId: string;
      userId: string;
      idempotencyKey?: string;
      body?: unknown;
    },
    originalUrl: string
  ): Headers {
    const headers = new Headers({
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Request-Id": command.requestId,
      "X-Tenant-Id": command.tenantId,
      "X-User-Id": command.userId
    });
    if (command.idempotencyKey) {
      headers.set("Idempotency-Key", command.idempotencyKey);
    }
    const internalAuthHeaders = this.internalAuthSignerService.sign({
      target: "auth-iam-service",
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
    const baseUrl = new URL(this.config.downstream.authIamServiceUrl);
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
          message: "Auth/IAM response is not valid JSON"
        }
      };
    }
  }

  private throwUpstreamError(response: globalThis.Response, envelope: ApiEnvelope<unknown>): never {
    const statusCode = response.status >= 400 ? response.status : 502;
    throw new HttpException(
      {
        code: envelope.error?.code ?? "UPSTREAM_ERROR",
        message: envelope.error?.message ?? "Auth/IAM request failed",
        details: envelope.error?.details ?? {
          upstream: "auth-iam-service"
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
    super("Auth/IAM upstream timed out");
    this.name = "UpstreamTimeoutError";
  }
}

import { HttpException, ServiceUnavailableException } from "@nestjs/common";

import { getAppConfig } from "../config/app.config.js";
import { InternalAuthSignerService, type InternalAuthTarget } from "./internal-auth-signer.service.js";

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

export interface InternalRequestCommand {
  target: InternalAuthTarget;
  baseUrl: string;
  method: string;
  path: string;
  requestId: string;
  tenantId?: string;
  userId?: string;
  body?: unknown;
}

const SAFE_RETRY_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const RETRYABLE_STATUS_CODES = new Set([502, 503, 504]);

export class InternalHttpClient {
  protected readonly config = getAppConfig();

  constructor(private readonly internalAuthSignerService: InternalAuthSignerService) {}

  protected async request<T>(command: InternalRequestCommand): Promise<T> {
    const targetUrl = this.buildUrl(command.baseUrl, command.path);
    const originalUrl = `${targetUrl.pathname}${targetUrl.search}`;
    const headers = this.buildHeaders(command, originalUrl);
    const response = await this.fetchWithPolicy(targetUrl, command, headers);
    const envelope = await this.readEnvelope<T>(response, command.target);

    if (!response.ok || envelope.success === false) {
      this.throwUpstreamError(response, envelope, command.target);
    }

    if (envelope.data === undefined) {
      throw new ServiceUnavailableException({
        code: "UPSTREAM_INVALID_RESPONSE",
        message: `${command.target} response does not include data`
      });
    }

    return envelope.data;
  }

  private async fetchWithPolicy(
    targetUrl: URL,
    command: Pick<InternalRequestCommand, "method" | "body">,
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
        message: "Upstream request timed out",
        details: {
          timeoutMs: this.config.downstream.timeoutMs
        }
      });
    }

    throw new ServiceUnavailableException({
      code: "UPSTREAM_UNAVAILABLE",
      message: "Upstream service unavailable"
    });
  }

  private async fetchOnce(
    targetUrl: URL,
    command: Pick<InternalRequestCommand, "method" | "body">,
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

  private buildHeaders(command: InternalRequestCommand, originalUrl: string): Headers {
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
      target: command.target,
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

  private buildUrl(baseUrlValue: string, path: string): URL {
    const baseUrl = new URL(baseUrlValue);
    const pathUrl = new URL(path, "http://wms.local");
    const normalizedBasePath = baseUrl.pathname.endsWith("/") ? baseUrl.pathname.slice(0, -1) : baseUrl.pathname;
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

  private async readEnvelope<T>(response: globalThis.Response, target: InternalAuthTarget): Promise<ApiEnvelope<T>> {
    try {
      return (await response.json()) as ApiEnvelope<T>;
    } catch {
      return {
        success: false,
        error: {
          code: "UPSTREAM_INVALID_RESPONSE",
          message: `${target} response is not valid JSON`
        }
      };
    }
  }

  private throwUpstreamError(response: globalThis.Response, envelope: ApiEnvelope<unknown>, target: InternalAuthTarget): never {
    const statusCode = response.status >= 400 ? response.status : 502;
    throw new HttpException(
      {
        code: envelope.error?.code ?? "UPSTREAM_ERROR",
        message: envelope.error?.message ?? `${target} request failed`,
        details: envelope.error?.details ?? {
          upstream: target
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
    super("Upstream timed out");
    this.name = "UpstreamTimeoutError";
  }
}

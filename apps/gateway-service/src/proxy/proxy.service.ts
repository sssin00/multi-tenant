import { GatewayTimeoutException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import type { Response } from "express";

import type { ProxyRouteConfig } from "../config/app.config.js";
import { getAppConfig } from "../config/app.config.js";
import type { GatewayRequest } from "../context/request-context.js";

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "content-length",
  "expect",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade"
]);

const RETRYABLE_STATUS_CODES = new Set([502, 503, 504]);
const SAFE_RETRY_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

interface UpstreamAttemptResult {
  response: globalThis.Response;
  durationMs: number;
}

@Injectable()
export class ProxyService {
  private readonly config = getAppConfig();

  async forward(req: GatewayRequest, res: Response, route: ProxyRouteConfig) {
    const targetUrl = this.buildTargetUrl(req, route);

    const upstreamResponse = await this.fetchWithPolicy(req, route, targetUrl);

    res.status(upstreamResponse.status);
    upstreamResponse.headers.forEach((value, name) => {
      if (!HOP_BY_HOP_HEADERS.has(name)) {
        res.setHeader(name, value);
      }
    });
    res.send(Buffer.from(await upstreamResponse.arrayBuffer()));
  }

  private async fetchWithPolicy(
    req: GatewayRequest,
    route: ProxyRouteConfig,
    targetUrl: string
  ): Promise<globalThis.Response> {
    const maxAttempts = this.maxAttempts(req.method, route);
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const result = await this.fetchOnce(req, route, targetUrl);
        this.logUpstreamAttempt(req, route, attempt, result.durationMs, result.response.status);

        if (this.shouldRetryResponse(req.method, route, attempt, result.response.status)) {
          await result.response.body?.cancel();
          continue;
        }

        return result.response;
      } catch (error) {
        lastError = error;
        const durationMs = error instanceof UpstreamTimeoutError ? route.timeoutMs : undefined;
        this.logUpstreamAttempt(req, route, attempt, durationMs, undefined, this.errorCode(error));

        if (!this.shouldRetryError(req.method, route, attempt, error)) {
          break;
        }
      }
    }

    this.throwUpstreamError(route, lastError);
  }

  private async fetchOnce(
    req: GatewayRequest,
    route: ProxyRouteConfig,
    targetUrl: string
  ): Promise<UpstreamAttemptResult> {
    const startedAt = performance.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), route.timeoutMs);

    try {
      const response = await fetch(targetUrl, {
        method: req.method,
        headers: this.buildHeaders(req),
        body: this.hasRequestBody(req.method) ? req : undefined,
        duplex: "half",
        redirect: "manual",
        signal: controller.signal
      } as RequestInit);

      return {
        response,
        durationMs: Math.round((performance.now() - startedAt) * 100) / 100
      };
    } catch (error) {
      if (controller.signal.aborted) {
        throw new UpstreamTimeoutError(route.key, route.timeoutMs);
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private buildTargetUrl(req: GatewayRequest, route: ProxyRouteConfig): string {
    const incoming = new URL(req.originalUrl, "http://gateway.local");
    const upstream = new URL(route.upstreamUrl);
    const pathSuffix = incoming.pathname.slice(route.publicPathPrefix.length) || "/";
    const basePath = upstream.pathname.endsWith("/") ? upstream.pathname.slice(0, -1) : upstream.pathname;

    upstream.pathname = `${basePath}${pathSuffix}`;
    upstream.search = incoming.search;
    return upstream.toString();
  }

  private buildHeaders(req: GatewayRequest): Headers {
    const headers = new Headers();

    for (const [name, value] of Object.entries(req.headers)) {
      if (HOP_BY_HOP_HEADERS.has(name)) {
        continue;
      }

      if (Array.isArray(value)) {
        for (const item of value) {
          headers.append(name, item);
        }
      } else if (value !== undefined) {
        headers.set(name, value);
      }
    }

    headers.set(this.config.requestIdHeader, req.context.requestId);
    if (req.context.tenantId) {
      headers.set(this.config.tenantHeader, req.context.tenantId);
    }
    if (req.context.userId) {
      headers.set("x-user-id", req.context.userId);
    }

    return headers;
  }

  private hasRequestBody(method: string): boolean {
    return !["GET", "HEAD"].includes(method.toUpperCase());
  }

  private maxAttempts(method: string, route: ProxyRouteConfig): number {
    return this.canRetryMethod(method) ? route.retryCount + 1 : 1;
  }

  private shouldRetryResponse(
    method: string,
    route: ProxyRouteConfig,
    attempt: number,
    statusCode: number
  ): boolean {
    return this.canRetryMethod(method) && attempt <= route.retryCount && RETRYABLE_STATUS_CODES.has(statusCode);
  }

  private shouldRetryError(
    method: string,
    route: ProxyRouteConfig,
    attempt: number,
    error: unknown
  ): boolean {
    return this.canRetryMethod(method) && attempt <= route.retryCount && this.isRetryableError(error);
  }

  private canRetryMethod(method: string): boolean {
    return SAFE_RETRY_METHODS.has(method.toUpperCase());
  }

  private isRetryableError(error: unknown): boolean {
    return error instanceof UpstreamTimeoutError || error instanceof Error;
  }

  private throwUpstreamError(route: ProxyRouteConfig, error: unknown): never {
    if (error instanceof UpstreamTimeoutError) {
      throw new GatewayTimeoutException({
        code: "GATEWAY_TIMEOUT",
        message: "Upstream request timed out",
        details: {
          route: route.key,
          upstreamUrl: route.upstreamUrl,
          timeoutMs: route.timeoutMs
        }
      });
    }

    throw new ServiceUnavailableException({
      code: "UPSTREAM_UNAVAILABLE",
      message: "Upstream service unavailable",
      details: {
        route: route.key,
        upstreamUrl: route.upstreamUrl,
        cause: error instanceof Error ? error.message : "unknown"
      }
    });
  }

  private errorCode(error: unknown): string {
    return error instanceof UpstreamTimeoutError ? "GATEWAY_TIMEOUT" : "UPSTREAM_UNAVAILABLE";
  }

  private logUpstreamAttempt(
    req: GatewayRequest,
    route: ProxyRouteConfig,
    attempt: number,
    durationMs?: number,
    statusCode?: number,
    errorCode?: string
  ) {
    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: errorCode ? "error" : "info",
        service: this.config.serviceName,
        env: this.config.env,
        message: "Upstream request completed",
        requestId: req.context.requestId,
        tenantId: req.context.tenantId,
        userId: req.context.userId,
        method: req.method,
        path: req.path,
        upstream: route.key,
        attempt,
        durationMs,
        statusCode,
        errorCode
      })
    );
  }
}

class UpstreamTimeoutError extends Error {
  constructor(routeKey: ProxyRouteConfig["key"], timeoutMs: number) {
    super(`${routeKey} upstream timed out after ${timeoutMs}ms`);
    this.name = "UpstreamTimeoutError";
  }
}

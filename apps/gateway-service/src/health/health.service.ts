import { Injectable } from "@nestjs/common";

import { getAppConfig, type AppConfig, type ProxyRouteConfig } from "../config/app.config.js";

export interface ReadinessResponse {
  status: "ready" | "not_ready";
  service: string;
  timestamp: string;
  checks: {
    config: ReadinessCheck;
    jwt: ReadinessCheck;
    proxyRoutes: ReadinessCheck;
    rateLimit: ReadinessCheck;
    security: ReadinessCheck;
  };
}

interface ReadinessCheck {
  status: "ok" | "failed";
  message?: string;
}

@Injectable()
export class HealthService {
  private readonly config = getAppConfig();

  getReadiness(): ReadinessResponse {
    const checks = {
      config: this.checkConfig(this.config),
      jwt: this.checkJwt(this.config),
      proxyRoutes: this.checkProxyRoutes(this.config),
      rateLimit: this.checkRateLimit(this.config),
      security: this.checkSecurity(this.config)
    };
    const isReady = Object.values(checks).every((check) => check.status === "ok");

    return {
      status: isReady ? "ready" : "not_ready",
      service: this.config.serviceName,
      timestamp: new Date().toISOString(),
      checks
    };
  }

  private checkConfig(config: AppConfig): ReadinessCheck {
    if (!config.port || config.port <= 0) {
      return { status: "failed", message: "GATEWAY_PORT must be a positive number" };
    }

    if (!config.requestIdHeader || !config.tenantHeader) {
      return { status: "failed", message: "Request context headers must be configured" };
    }

    return { status: "ok" };
  }

  private checkRateLimit(config: AppConfig): ReadinessCheck {
    if (!config.rateLimit.enabled) {
      return { status: "ok", message: "Rate limit is disabled" };
    }

    if (!config.redis.url) {
      return { status: "failed", message: "REDIS_URL is required when rate limit is enabled" };
    }

    if (config.rateLimit.windowSeconds <= 0) {
      return { status: "failed", message: "GATEWAY_RATE_LIMIT_WINDOW_SECONDS must be positive" };
    }

    const invalidLimit = Object.entries(config.rateLimit.limits).find(([, limit]) => limit <= 0);
    if (invalidLimit) {
      return {
        status: "failed",
        message: `${invalidLimit[0]} rate limit must be positive`
      };
    }

    return { status: "ok" };
  }

  private checkSecurity(config: AppConfig): ReadinessCheck {
    if (config.env === "prod" && config.cors.allowedOrigins.length === 0) {
      return { status: "failed", message: "GATEWAY_CORS_ALLOWED_ORIGINS is required in prod" };
    }

    if (config.cors.allowedOrigins.some((origin) => origin === "*")) {
      return { status: "failed", message: "Wildcard CORS origin is not allowed" };
    }

    return { status: "ok" };
  }

  private checkJwt(config: AppConfig): ReadinessCheck {
    if (config.jwt.algorithm === "HS256" && !config.jwt.secret) {
      return { status: "failed", message: "JWT_SECRET is required for HS256" };
    }

    if (config.jwt.algorithm === "RS256" && !config.jwt.publicKey) {
      return { status: "failed", message: "JWT_PUBLIC_KEY is required for RS256" };
    }

    if (!config.jwt.issuer) {
      return { status: "failed", message: "JWT_ISSUER is required" };
    }

    if (!config.jwt.audience) {
      return { status: "failed", message: "JWT_AUDIENCE is required" };
    }

    return { status: "ok" };
  }

  private checkProxyRoutes(config: AppConfig): ReadinessCheck {
    const routes = Object.values(config.routes);
    const invalidRoute = routes.find((route) => !this.isValidHttpUrl(route));
    if (invalidRoute) {
      return {
        status: "failed",
        message: `${invalidRoute.key} upstream URL must be a valid http or https URL`
      };
    }

    const invalidTimeoutRoute = routes.find((route) => route.timeoutMs <= 0);
    if (invalidTimeoutRoute) {
      return {
        status: "failed",
        message: `${invalidTimeoutRoute.key} upstream timeout must be a positive number`
      };
    }

    const invalidRetryRoute = routes.find((route) => route.retryCount < 0);
    if (invalidRetryRoute) {
      return {
        status: "failed",
        message: `${invalidRetryRoute.key} retry count must be zero or greater`
      };
    }

    return { status: "ok" };
  }

  private isValidHttpUrl(route: ProxyRouteConfig): boolean {
    return this.isValidHttpUrlValue(route.upstreamUrl);
  }

  private isValidHttpUrlValue(value: string): boolean {
    try {
      const url = new URL(value);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  }
}

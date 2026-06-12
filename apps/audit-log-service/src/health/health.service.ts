import { Injectable } from "@nestjs/common";

import { getAppConfig, type AppConfig } from "../config/app.config.js";

export interface ReadinessResponse {
  status: "ready" | "not_ready";
  service: string;
  timestamp: string;
  checks: {
    config: ReadinessCheck;
    internalAuth: ReadinessCheck;
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
      internalAuth: this.checkInternalAuth(this.config),
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
      return { status: "failed", message: "AUDIT_PORT must be a positive number" };
    }

    if (!config.requestIdHeader || !config.tenantHeader) {
      return { status: "failed", message: "Request context headers must be configured" };
    }

    return { status: "ok" };
  }

  private checkInternalAuth(config: AppConfig): ReadinessCheck {
    if (!config.internalAuth.enabled) {
      return { status: "ok" };
    }

    if (!config.internalAuth.secret) {
      return { status: "failed", message: "AUDIT_INTERNAL_AUTH_SECRET is required when internal auth is enabled" };
    }

    if (config.internalAuth.secret.length < 32) {
      return { status: "failed", message: "AUDIT_INTERNAL_AUTH_SECRET must be at least 32 characters" };
    }

    if (config.internalAuth.allowedServices.length === 0) {
      return { status: "failed", message: "AUDIT_INTERNAL_AUTH_ALLOWED_SERVICES must include at least one service" };
    }

    if (config.internalAuth.timestampSkewSeconds <= 0) {
      return { status: "failed", message: "AUDIT_INTERNAL_AUTH_TIMESTAMP_SKEW_SECONDS must be positive" };
    }

    return { status: "ok" };
  }

  private checkSecurity(config: AppConfig): ReadinessCheck {
    if (config.env === "prod" && config.cors.allowedOrigins.length === 0) {
      return { status: "failed", message: "AUDIT_CORS_ALLOWED_ORIGINS is required in prod" };
    }

    if (config.cors.allowedOrigins.some((origin) => origin === "*")) {
      return { status: "failed", message: "Wildcard CORS origin is not allowed" };
    }

    return { status: "ok" };
  }
}

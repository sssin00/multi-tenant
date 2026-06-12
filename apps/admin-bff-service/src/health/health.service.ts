import { Injectable } from "@nestjs/common";

import { getAppConfig, type AppConfig } from "../config/app.config.js";

export interface ReadinessResponse {
  status: "ready" | "not_ready";
  service: string;
  timestamp: string;
  checks: {
    config: ReadinessCheck;
    downstream: ReadinessCheck;
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
      downstream: this.checkDownstream(this.config),
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
      return { status: "failed", message: "ADMIN_BFF_PORT must be a positive number" };
    }

    if (!config.requestIdHeader || !config.tenantHeader) {
      return { status: "failed", message: "Request context headers must be configured" };
    }

    return { status: "ok" };
  }

  private checkDownstream(config: AppConfig): ReadinessCheck {
    if (!this.isValidHttpUrl(config.downstream.authIamServiceUrl)) {
      return { status: "failed", message: "AUTH_IAM_SERVICE_URL must be a valid http or https URL" };
    }

    if (!this.isValidHttpUrl(config.downstream.tenantServiceUrl)) {
      return { status: "failed", message: "TENANT_SERVICE_URL must be a valid http or https URL" };
    }

    if (config.downstream.auditLogServiceUrl && !this.isValidHttpUrl(config.downstream.auditLogServiceUrl)) {
      return { status: "failed", message: "AUDIT_LOG_SERVICE_URL must be a valid http or https URL" };
    }

    if (config.downstream.timeoutMs <= 0) {
      return { status: "failed", message: "ADMIN_BFF_DOWNSTREAM_TIMEOUT_MS must be positive" };
    }

    if (config.downstream.retryCount < 0) {
      return { status: "failed", message: "ADMIN_BFF_SAFE_METHOD_RETRIES must be zero or greater" };
    }

    return { status: "ok" };
  }

  private checkInternalAuth(config: AppConfig): ReadinessCheck {
    if (!config.internalAuth.enabled) {
      return { status: "ok", message: "Internal auth signing is disabled" };
    }

    if (!config.internalAuth.serviceId) {
      return { status: "failed", message: "ADMIN_BFF_INTERNAL_SERVICE_ID is required" };
    }

    if (!config.internalAuth.authIamSecret) {
      return { status: "failed", message: "AUTH_INTERNAL_AUTH_SECRET is required" };
    }

    if (!config.internalAuth.tenantSecret) {
      return { status: "failed", message: "TENANT_INTERNAL_AUTH_SECRET is required" };
    }

    if (config.internalAuth.authIamSecret.length < 32 || config.internalAuth.tenantSecret.length < 32) {
      return { status: "failed", message: "Internal auth secrets must be at least 32 characters" };
    }

    if (config.downstream.auditLogServiceUrl && !config.internalAuth.auditLogSecret) {
      return { status: "failed", message: "AUDIT_INTERNAL_AUTH_SECRET is required when AUDIT_LOG_SERVICE_URL is set" };
    }

    if (config.internalAuth.auditLogSecret && config.internalAuth.auditLogSecret.length < 32) {
      return { status: "failed", message: "AUDIT_INTERNAL_AUTH_SECRET must be at least 32 characters" };
    }

    if (config.internalAuth.timestampSkewSeconds <= 0) {
      return { status: "failed", message: "ADMIN_BFF_INTERNAL_AUTH_TIMESTAMP_SKEW_SECONDS must be positive" };
    }

    return { status: "ok" };
  }

  private checkSecurity(config: AppConfig): ReadinessCheck {
    if (config.env === "prod" && config.cors.allowedOrigins.length === 0) {
      return { status: "failed", message: "ADMIN_BFF_CORS_ALLOWED_ORIGINS is required in prod" };
    }

    if (config.cors.allowedOrigins.some((origin) => origin === "*")) {
      return { status: "failed", message: "Wildcard CORS origin is not allowed" };
    }

    return { status: "ok" };
  }

  private isValidHttpUrl(value: string): boolean {
    try {
      const url = new URL(value);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  }
}

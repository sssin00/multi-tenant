import { Inject, Injectable } from "@nestjs/common";

import { getAppConfig, type AppConfig } from "../config/app.config.js";
import { PrismaService } from "../database/prisma.service.js";

export interface ReadinessResponse {
  status: "ready" | "not_ready";
  service: string;
  timestamp: string;
  checks: {
    config: ReadinessCheck;
    internalAuth: ReadinessCheck;
    downstream: ReadinessCheck;
    database: ReadinessCheck;
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

  constructor(
    @Inject(PrismaService)
    private readonly prismaService: PrismaService
  ) {}

  async getReadiness(): Promise<ReadinessResponse> {
    const checks = {
      config: this.checkConfig(this.config),
      internalAuth: this.checkInternalAuth(this.config),
      downstream: this.checkDownstream(this.config),
      database: await this.checkDatabase(),
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
      return { status: "failed", message: "WMS_PORT must be a positive number" };
    }

    if (!config.requestIdHeader || !config.tenantHeader) {
      return { status: "failed", message: "Request context headers must be configured" };
    }

    if (!process.env.DATABASE_URL) {
      return { status: "failed", message: "DATABASE_URL is required" };
    }

    return { status: "ok" };
  }

  private checkInternalAuth(config: AppConfig): ReadinessCheck {
    if (!config.internalAuth.enabled) {
      return { status: "ok" };
    }

    if (!config.internalAuth.secret) {
      return { status: "failed", message: "WMS_INTERNAL_AUTH_SECRET is required when internal auth is enabled" };
    }

    if (config.internalAuth.secret.length < 32) {
      return { status: "failed", message: "WMS_INTERNAL_AUTH_SECRET must be at least 32 characters" };
    }

    if (config.internalAuth.allowedServices.length === 0) {
      return { status: "failed", message: "WMS_INTERNAL_AUTH_ALLOWED_SERVICES must include at least one service" };
    }

    if (config.internalAuth.timestampSkewSeconds <= 0) {
      return { status: "failed", message: "WMS_INTERNAL_AUTH_TIMESTAMP_SKEW_SECONDS must be positive" };
    }

    return { status: "ok" };
  }

  private checkDownstream(config: AppConfig): ReadinessCheck {
    if (config.internalAuth.enabled && !config.internalAuth.authIamSecret) {
      return { status: "failed", message: "AUTH_INTERNAL_AUTH_SECRET is required for permission checks" };
    }

    if (config.internalAuth.enabled && !config.internalAuth.tenantSecret) {
      return { status: "failed", message: "TENANT_INTERNAL_AUTH_SECRET is required for tenant module checks" };
    }

    if (!this.isValidHttpUrl(config.downstream.authIamServiceUrl)) {
      return { status: "failed", message: "AUTH_IAM_SERVICE_URL must be a valid http or https URL" };
    }

    if (!this.isValidHttpUrl(config.downstream.tenantServiceUrl)) {
      return { status: "failed", message: "TENANT_SERVICE_URL must be a valid http or https URL" };
    }

    if (config.downstream.timeoutMs <= 0 || config.downstream.retryCount < 0) {
      return { status: "failed", message: "Downstream timeout and retry settings must be non-negative" };
    }

    return { status: "ok" };
  }

  private checkSecurity(config: AppConfig): ReadinessCheck {
    if (config.env === "prod" && config.cors.allowedOrigins.length === 0) {
      return { status: "failed", message: "WMS_CORS_ALLOWED_ORIGINS is required in prod" };
    }

    if (config.cors.allowedOrigins.some((origin) => origin === "*")) {
      return { status: "failed", message: "Wildcard CORS origin is not allowed" };
    }

    return { status: "ok" };
  }

  private async checkDatabase(): Promise<ReadinessCheck> {
    try {
      await this.prismaService.ping();
      return { status: "ok" };
    } catch {
      return { status: "failed", message: "DATABASE_URL is unavailable" };
    }
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

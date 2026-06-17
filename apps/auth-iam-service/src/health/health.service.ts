import { Inject, Injectable } from "@nestjs/common";

import { RedisService } from "../cache/redis.service.js";
import { getAppConfig, type AppConfig } from "../config/app.config.js";
import { PrismaService } from "../database/prisma.service.js";

export interface ReadinessResponse {
  status: "ready" | "not_ready";
  service: string;
  timestamp: string;
  checks: {
    config: ReadinessCheck;
    jwt: ReadinessCheck;
    internalAuth: ReadinessCheck;
    database: ReadinessCheck;
    redis: ReadinessCheck;
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
    private readonly prismaService: PrismaService,
    @Inject(RedisService)
    private readonly redisService: RedisService
  ) {}

  async getReadiness(): Promise<ReadinessResponse> {
    const checks = {
      config: this.checkConfig(this.config),
      jwt: this.checkJwt(this.config),
      internalAuth: this.checkInternalAuth(this.config),
      database: await this.checkDatabase(),
      redis: await this.checkRedis(this.config),
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
      return { status: "failed", message: "AUTH_PORT must be a positive number" };
    }

    if (!config.requestIdHeader || !config.tenantHeader) {
      return { status: "failed", message: "Request context headers must be configured" };
    }

    if (!config.redis.url) {
      return { status: "failed", message: "REDIS_URL is required" };
    }

    if (!this.isValidRedisUrl(config.redis.url)) {
      return { status: "failed", message: "REDIS_URL must be a valid redis or rediss URL" };
    }

    return { status: "ok" };
  }

  private checkJwt(config: AppConfig): ReadinessCheck {
    if (config.jwt.algorithm === "HS256" && !config.jwt.secret) {
      return { status: "failed", message: "JWT_SECRET is required for HS256" };
    }

    if (config.jwt.algorithm === "RS256" && !config.jwt.privateKey) {
      return { status: "failed", message: "JWT_PRIVATE_KEY is required for RS256" };
    }

    if (!config.jwt.issuer) {
      return { status: "failed", message: "JWT_ISSUER is required" };
    }

    if (!config.jwt.audience) {
      return { status: "failed", message: "JWT_AUDIENCE is required" };
    }

    if (config.auth.accessTokenTtlSeconds <= 0) {
      return { status: "failed", message: "AUTH_ACCESS_TOKEN_TTL_SECONDS must be positive" };
    }

    if (config.auth.refreshTokenTtlSeconds <= 0) {
      return { status: "failed", message: "AUTH_REFRESH_TOKEN_TTL_SECONDS must be positive" };
    }

    return { status: "ok" };
  }

  private checkInternalAuth(config: AppConfig): ReadinessCheck {
    if (!config.internalAuth.enabled) {
      return { status: "ok" };
    }

    if (!config.internalAuth.secret) {
      return { status: "failed", message: "AUTH_INTERNAL_AUTH_SECRET is required when internal auth is enabled" };
    }

    if (config.internalAuth.secret.length < 32) {
      return { status: "failed", message: "AUTH_INTERNAL_AUTH_SECRET must be at least 32 characters" };
    }

    if (config.internalAuth.allowedServices.length === 0) {
      return { status: "failed", message: "AUTH_INTERNAL_AUTH_ALLOWED_SERVICES must include at least one service" };
    }

    if (config.internalAuth.timestampSkewSeconds <= 0) {
      return { status: "failed", message: "AUTH_INTERNAL_AUTH_TIMESTAMP_SKEW_SECONDS must be positive" };
    }

    return { status: "ok" };
  }

  private checkSecurity(config: AppConfig): ReadinessCheck {
    if (config.env === "prod" && config.cors.allowedOrigins.length === 0) {
      return { status: "failed", message: "AUTH_CORS_ALLOWED_ORIGINS is required in prod" };
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

  private async checkRedis(config: AppConfig): Promise<ReadinessCheck> {
    if (!config.redis.url) {
      return { status: "failed", message: "REDIS_URL is required" };
    }

    try {
      const isAvailable = await this.redisService.ping();
      return isAvailable
        ? { status: "ok" }
        : { status: "failed", message: "Redis PING did not return PONG" };
    } catch {
      return { status: "failed", message: "REDIS_URL is unavailable" };
    }
  }

  private isValidRedisUrl(value: string): boolean {
    try {
      const url = new URL(value);
      return url.protocol === "redis:" || url.protocol === "rediss:";
    } catch {
      return false;
    }
  }

}

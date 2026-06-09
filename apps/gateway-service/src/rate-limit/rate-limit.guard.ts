import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  ServiceUnavailableException
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Response } from "express";

import { getAppConfig, type ProxyRouteConfig } from "../config/app.config.js";
import type { GatewayRequest } from "../context/request-context.js";
import { IS_PUBLIC_ROUTE } from "../auth/public.decorator.js";
import { RedisRateLimitService } from "./redis-rate-limit.service.js";

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly config = getAppConfig();

  constructor(
    @Inject(Reflector)
    private readonly reflector: Reflector,
    @Inject(RedisRateLimitService)
    private readonly redisRateLimitService: RedisRateLimitService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_ROUTE, [
      context.getHandler(),
      context.getClass()
    ]);

    if (isPublic || !this.config.rateLimit.enabled) {
      return true;
    }

    const req = context.switchToHttp().getRequest<GatewayRequest>();
    if (!req.path.startsWith("/api/v1/")) {
      return true;
    }

    const routeGroup = this.getRouteGroup(req.path);
    if (!routeGroup) {
      return true;
    }

    const res = context.switchToHttp().getResponse<Response>();
    const limit = this.config.rateLimit.limits[routeGroup];
    const key = this.buildKey(req, routeGroup);

    try {
      const result = await this.redisRateLimitService.consume(
        key,
        limit,
        this.config.rateLimit.windowSeconds
      );

      res.setHeader("X-RateLimit-Limit", String(result.limit));
      res.setHeader("X-RateLimit-Remaining", String(result.remaining));
      res.setHeader("X-RateLimit-Reset", String(result.resetAt));

      if (result.exceeded) {
        throw this.tooManyRequests(routeGroup, result.limit, result.resetAt);
      }

      return true;
    } catch (error) {
      if (error instanceof HttpException && error.getStatus() === HttpStatus.TOO_MANY_REQUESTS) {
        throw error;
      }

      throw new ServiceUnavailableException({
        code: "RATE_LIMIT_UNAVAILABLE",
        message: "Rate limit storage unavailable",
        details: {
          routeGroup
        }
      });
    }
  }

  private getRouteGroup(path: string): ProxyRouteConfig["key"] | undefined {
    if (path === "/api/v1/auth" || path.startsWith("/api/v1/auth/")) {
      return "auth";
    }

    if (path === "/api/v1/admin" || path.startsWith("/api/v1/admin/")) {
      return "admin";
    }

    if (path === "/api/v1/app" || path.startsWith("/api/v1/app/")) {
      return "app";
    }

    return undefined;
  }

  private buildKey(req: GatewayRequest, routeGroup: ProxyRouteConfig["key"]): string {
    if (req.context.tenantId && req.context.userId) {
      return [
        "rate-limit",
        this.config.env,
        "gateway",
        req.context.tenantId,
        req.context.userId,
        routeGroup
      ].join(":");
    }

    return [
      "rate-limit",
      this.config.env,
      "gateway",
      "anonymous",
      this.clientIp(req),
      routeGroup
    ].join(":");
  }

  private clientIp(req: GatewayRequest): string {
    const forwardedFor = req.headers["x-forwarded-for"];
    if (Array.isArray(forwardedFor)) {
      return forwardedFor[0]?.split(",")[0]?.trim() || req.ip || "unknown";
    }

    return forwardedFor?.split(",")[0]?.trim() || req.ip || "unknown";
  }

  private tooManyRequests(
    routeGroup: ProxyRouteConfig["key"],
    limit: number,
    resetAt: number
  ): HttpException {
    return new HttpException(
      {
        code: "RATE_LIMIT_EXCEEDED",
        message: "Rate limit exceeded",
        details: {
          routeGroup,
          limit,
          windowSeconds: this.config.rateLimit.windowSeconds,
          resetAt
        }
      },
      HttpStatus.TOO_MANY_REQUESTS
    );
  }
}

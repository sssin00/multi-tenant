import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  ServiceUnavailableException
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";

import { IS_PUBLIC_ROUTE } from "../auth/public.decorator.js";
import { getAppConfig } from "../config/app.config.js";
import type { GatewayRequest } from "../context/request-context.js";
import { TenantStatusService } from "./tenant-status.service.js";

@Injectable()
export class TenantStatusGuard implements CanActivate {
  private readonly config = getAppConfig();

  constructor(
    @Inject(Reflector)
    private readonly reflector: Reflector,
    @Inject(TenantStatusService)
    private readonly tenantStatusService: TenantStatusService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_ROUTE, [
      context.getHandler(),
      context.getClass()
    ]);

    if (isPublic || !this.config.tenantStatus.enabled) {
      return true;
    }

    const req = context.switchToHttp().getRequest<GatewayRequest>();
    if (!req.path.startsWith("/api/")) {
      return true;
    }

    if (this.isPublicAuthEndpoint(req)) {
      return true;
    }

    const tenantId = req.context.tenantId;
    if (!tenantId) {
      throw new ForbiddenException({
        code: "TENANT_REQUIRED",
        message: "Tenant context is required"
      });
    }

    try {
      const result = await this.tenantStatusService.getStatus(tenantId);
      this.logTenantStatus(req, "checked", result.status, result.source);

      if (result.status !== "active") {
        this.logTenantStatus(req, "blocked", result.status, result.source, "TENANT_NOT_READY");
        throw new ForbiddenException({
          code: "TENANT_NOT_READY",
          message: "Tenant is not ready",
          details: {
            tenantId,
            status: result.status
          }
        });
      }

      return true;
    } catch (error) {
      if (error instanceof ForbiddenException) {
        throw error;
      }

      this.logTenantStatus(req, "failed", undefined, undefined, "TENANT_STATUS_UNAVAILABLE");
      throw new ServiceUnavailableException({
        code: "TENANT_STATUS_UNAVAILABLE",
        message: "Tenant status check unavailable",
        details: {
          tenantId
        }
      });
    }
  }

  private logTenantStatus(
    req: GatewayRequest,
    result: "checked" | "blocked" | "failed",
    status?: string,
    source?: string,
    errorCode?: string
  ) {
    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: errorCode ? "error" : "info",
        service: this.config.serviceName,
        env: this.config.env,
        message: "Tenant status check",
        operation: "tenant_status_check",
        result,
        tenantStatus: status,
        source,
        requestId: req.context.requestId,
        tenantId: req.context.tenantId,
        userId: req.context.userId,
        errorCode
      })
    );
  }

  private isPublicAuthEndpoint(req: GatewayRequest): boolean {
    if (req.method.toUpperCase() !== "POST") {
      return false;
    }

    const path = req.path.endsWith("/") ? req.path.slice(0, -1) : req.path;
    return path === "/api/auth/login" || path === "/api/auth/token/refresh";
  }
}

import { Controller, Get, Inject, Param, Req } from "@nestjs/common";

import type { TenantRequest } from "../context/request-context.js";
import { InternalService } from "../internal-auth/internal-service.decorator.js";
import { TenantsService } from "./tenants.service.js";

@Controller("internal/tenants")
export class TenantsController {
  constructor(
    @Inject(TenantsService)
    private readonly tenantsService: TenantsService
  ) {}

  @InternalService({ allowedServices: ["admin-bff-service", "user-bff-service"] })
  @Get(":tenantId/status")
  async getStatus(@Param("tenantId") tenantId: string, @Req() req: TenantRequest) {
    const result = await this.tenantsService.getStatus({
      tenantId,
      requestId: req.context.requestId,
      callerTenantId: req.context.tenantId,
      callerUserId: req.context.userId
    });

    return this.success(req, result);
  }

  @InternalService({ allowedServices: ["admin-bff-service", "user-bff-service", "wms-service"] })
  @Get(":tenantId/modules")
  async getModules(@Param("tenantId") tenantId: string, @Req() req: TenantRequest) {
    const result = await this.tenantsService.getModules({
      tenantId,
      requestId: req.context.requestId,
      callerTenantId: req.context.tenantId,
      callerUserId: req.context.userId
    });

    return this.success(req, result);
  }

  private success(req: TenantRequest, data: unknown) {
    return {
      success: true,
      requestId: req.context.requestId,
      timestamp: new Date().toISOString(),
      data
    };
  }
}

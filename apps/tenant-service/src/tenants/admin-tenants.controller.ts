import { Body, Controller, HttpCode, Inject, Post, Req } from "@nestjs/common";

import type { TenantRequest } from "../context/request-context.js";
import { InternalService } from "../internal-auth/internal-service.decorator.js";
import { TenantsService } from "./tenants.service.js";

@Controller("internal/admin/tenants")
export class AdminTenantsController {
  constructor(
    @Inject(TenantsService)
    private readonly tenantsService: TenantsService
  ) {}

  @InternalService({ allowedServices: ["admin-bff-service"] })
  @HttpCode(201)
  @Post()
  async create(@Body() body: unknown, @Req() req: TenantRequest) {
    const result = await this.tenantsService.create({
      body,
      requestId: req.context.requestId,
      callerTenantId: req.context.tenantId,
      callerUserId: req.context.userId
    });

    return {
      success: true,
      requestId: req.context.requestId,
      timestamp: new Date().toISOString(),
      data: result
    };
  }
}

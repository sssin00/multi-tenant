import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Put, Query, Req } from "@nestjs/common";

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
  @Get()
  async list(@Query() query: Record<string, unknown>, @Req() req: TenantRequest) {
    const result = await this.tenantsService.list({
      query,
      requestId: req.context.requestId,
      callerTenantId: req.context.tenantId,
      callerUserId: req.context.userId
    });

    return this.success(req, result);
  }

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

  @InternalService({ allowedServices: ["admin-bff-service"] })
  @Patch(":tenantId/status")
  async updateStatus(@Param("tenantId") tenantId: string, @Body() body: unknown, @Req() req: TenantRequest) {
    const result = await this.tenantsService.updateStatus({
      tenantId,
      body,
      requestId: req.context.requestId,
      callerTenantId: req.context.tenantId,
      callerUserId: req.context.userId
    });

    return this.success(req, result);
  }

  @InternalService({ allowedServices: ["admin-bff-service"] })
  @Get(":tenantId")
  async get(@Param("tenantId") tenantId: string, @Req() req: TenantRequest) {
    const result = await this.tenantsService.get({
      tenantId,
      requestId: req.context.requestId,
      callerTenantId: req.context.tenantId,
      callerUserId: req.context.userId
    });

    return this.success(req, result);
  }

  @InternalService({ allowedServices: ["admin-bff-service"] })
  @Patch(":tenantId")
  async update(@Param("tenantId") tenantId: string, @Body() body: unknown, @Req() req: TenantRequest) {
    const result = await this.tenantsService.update({
      tenantId,
      body,
      requestId: req.context.requestId,
      callerTenantId: req.context.tenantId,
      callerUserId: req.context.userId
    });

    return this.success(req, result);
  }

  @InternalService({ allowedServices: ["admin-bff-service"] })
  @Put(":tenantId/modules")
  async replaceModules(@Param("tenantId") tenantId: string, @Body() body: unknown, @Req() req: TenantRequest) {
    const result = await this.tenantsService.replaceModules({
      tenantId,
      body,
      requestId: req.context.requestId,
      callerTenantId: req.context.tenantId,
      callerUserId: req.context.userId
    });

    return this.success(req, result);
  }

  @InternalService({ allowedServices: ["admin-bff-service"] })
  @Get(":tenantId/domains")
  async listDomains(@Param("tenantId") tenantId: string, @Req() req: TenantRequest) {
    const result = await this.tenantsService.listDomains({
      tenantId,
      requestId: req.context.requestId,
      callerTenantId: req.context.tenantId,
      callerUserId: req.context.userId
    });

    return this.success(req, result);
  }

  @InternalService({ allowedServices: ["admin-bff-service"] })
  @HttpCode(201)
  @Post(":tenantId/domains")
  async addDomain(@Param("tenantId") tenantId: string, @Body() body: unknown, @Req() req: TenantRequest) {
    const result = await this.tenantsService.addDomain({
      tenantId,
      body,
      requestId: req.context.requestId,
      callerTenantId: req.context.tenantId,
      callerUserId: req.context.userId
    });

    return this.success(req, result);
  }

  @InternalService({ allowedServices: ["admin-bff-service"] })
  @Delete(":tenantId/domains/:domainId")
  async deleteDomain(
    @Param("tenantId") tenantId: string,
    @Param("domainId") domainId: string,
    @Req() req: TenantRequest
  ) {
    const result = await this.tenantsService.deleteDomain({
      tenantId,
      domainId,
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

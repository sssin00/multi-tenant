import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Put, Query, Req } from "@nestjs/common";

import { AdminPermission } from "../auth/admin-permission.decorator.js";
import { requireIdempotencyKey } from "../auth/idempotency.js";
import type { AdminBffRequest } from "../context/request-context.js";
import { TenantInternalClient } from "../internal-clients/tenant-internal.client.js";

@Controller("api/admin/tenants")
export class AdminTenantsController {
  constructor(
    @Inject(TenantInternalClient)
    private readonly tenantInternalClient: TenantInternalClient
  ) {}

  @AdminPermission("tenant.tenants.read")
  @Get()
  async list(@Query() query: Record<string, unknown>, @Req() req: AdminBffRequest) {
    const result = await this.tenantInternalClient.listTenants(this.context(req), query);
    return this.success(req, result);
  }

  @AdminPermission("tenant.tenants.create")
  @HttpCode(201)
  @Post()
  async create(@Body() body: unknown, @Req() req: AdminBffRequest) {
    const idempotencyKey = requireIdempotencyKey(req);
    const result = await this.tenantInternalClient.createTenant(this.context(req, idempotencyKey), body);
    return this.success(req, result);
  }

  @AdminPermission("tenant.tenants.read")
  @Get(":tenantId")
  async get(@Param("tenantId") tenantId: string, @Req() req: AdminBffRequest) {
    const result = await this.tenantInternalClient.getTenant(this.context(req), tenantId);
    return this.success(req, result);
  }

  @AdminPermission("tenant.tenants.update")
  @Patch(":tenantId")
  async update(@Param("tenantId") tenantId: string, @Body() body: unknown, @Req() req: AdminBffRequest) {
    const idempotencyKey = requireIdempotencyKey(req);
    const result = await this.tenantInternalClient.updateTenant(this.context(req, idempotencyKey), tenantId, body);
    return this.success(req, result);
  }

  @AdminPermission("tenant.tenants.updateStatus")
  @Patch(":tenantId/status")
  async updateStatus(@Param("tenantId") tenantId: string, @Body() body: unknown, @Req() req: AdminBffRequest) {
    const idempotencyKey = requireIdempotencyKey(req);
    const result = await this.tenantInternalClient.updateTenantStatus(this.context(req, idempotencyKey), tenantId, body);
    return this.success(req, result);
  }

  @AdminPermission("tenant.modules.manage")
  @Put(":tenantId/modules")
  async replaceModules(@Param("tenantId") tenantId: string, @Body() body: unknown, @Req() req: AdminBffRequest) {
    const idempotencyKey = requireIdempotencyKey(req);
    const result = await this.tenantInternalClient.replaceTenantModules(this.context(req, idempotencyKey), tenantId, body);
    return this.success(req, result);
  }

  @AdminPermission("tenant.domains.read")
  @Get(":tenantId/domains")
  async listDomains(@Param("tenantId") tenantId: string, @Req() req: AdminBffRequest) {
    const result = await this.tenantInternalClient.listTenantDomains(this.context(req), tenantId);
    return this.success(req, result);
  }

  @AdminPermission("tenant.domains.manage")
  @HttpCode(201)
  @Post(":tenantId/domains")
  async addDomain(@Param("tenantId") tenantId: string, @Body() body: unknown, @Req() req: AdminBffRequest) {
    const idempotencyKey = requireIdempotencyKey(req);
    const result = await this.tenantInternalClient.addTenantDomain(this.context(req, idempotencyKey), tenantId, body);
    return this.success(req, result);
  }

  @AdminPermission("tenant.domains.manage")
  @Delete(":tenantId/domains/:domainId")
  async deleteDomain(
    @Param("tenantId") tenantId: string,
    @Param("domainId") domainId: string,
    @Req() req: AdminBffRequest
  ) {
    const idempotencyKey = requireIdempotencyKey(req);
    const result = await this.tenantInternalClient.deleteTenantDomain(
      this.context(req, idempotencyKey),
      tenantId,
      domainId
    );
    return this.success(req, result);
  }

  private context(req: AdminBffRequest, idempotencyKey?: string) {
    return {
      requestId: req.context.requestId,
      tenantId: req.context.tenantId,
      userId: req.context.userId,
      idempotencyKey
    };
  }

  private success(req: AdminBffRequest, data: unknown) {
    return {
      success: true,
      requestId: req.context.requestId,
      timestamp: new Date().toISOString(),
      data
    };
  }
}

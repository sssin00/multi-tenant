import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req
} from "@nestjs/common";

import { AdminAuditService } from "../audit/admin-audit.service.js";
import { AdminPermission } from "../auth/admin-permission.decorator.js";
import { requireIdempotencyKey } from "../auth/idempotency.js";
import type { AdminBffRequest } from "../context/request-context.js";
import { TenantInternalClient } from "../internal-clients/tenant-internal.client.js";

@Controller("api/admin/tenants")
export class AdminTenantsController {
  constructor(
    @Inject(TenantInternalClient)
    private readonly tenantInternalClient: TenantInternalClient,
    @Inject(AdminAuditService)
    private readonly adminAuditService: AdminAuditService
  ) {}

  @AdminPermission("tenant.tenants.read")
  @Get()
  async list(@Query() query: Record<string, unknown>, @Req() req: AdminBffRequest) {
    this.assertSystemAdmin(req);
    const result = await this.tenantInternalClient.listTenants(this.context(req), query);
    return this.success(req, result);
  }

  @AdminPermission("tenant.tenants.create")
  @HttpCode(201)
  @Post()
  async create(@Body() body: unknown, @Req() req: AdminBffRequest) {
    this.assertSystemAdmin(req);
    const idempotencyKey = requireIdempotencyKey(req);
    const result = await this.tenantInternalClient.createTenant(this.context(req, idempotencyKey), body);
    await this.adminAuditService.record(req, {
      action: "admin.tenant.created",
      resourceType: "tenant",
      resourceId: result.tenantId,
      details: {
        tenantId: result.tenantId,
        code: result.code,
        status: result.status
      }
    });
    return this.success(req, result);
  }

  @AdminPermission("tenant.tenants.read")
  @Get(":tenantId")
  async get(@Param("tenantId") tenantId: string, @Req() req: AdminBffRequest) {
    this.assertSystemAdmin(req);
    const result = await this.tenantInternalClient.getTenant(this.context(req), tenantId);
    return this.success(req, result);
  }

  @AdminPermission("tenant.tenants.update")
  @Patch(":tenantId")
  async update(@Param("tenantId") tenantId: string, @Body() body: unknown, @Req() req: AdminBffRequest) {
    this.assertSystemAdmin(req);
    const idempotencyKey = requireIdempotencyKey(req);
    const result = await this.tenantInternalClient.updateTenant(this.context(req, idempotencyKey), tenantId, body);
    await this.adminAuditService.record(req, {
      action: "admin.tenant.updated",
      resourceType: "tenant",
      resourceId: tenantId,
      details: {
        tenantId,
        code: result.code,
        status: result.status
      }
    });
    return this.success(req, result);
  }

  @AdminPermission("tenant.tenants.updateStatus")
  @Patch(":tenantId/status")
  async updateStatus(@Param("tenantId") tenantId: string, @Body() body: unknown, @Req() req: AdminBffRequest) {
    this.assertSystemAdmin(req);
    const idempotencyKey = requireIdempotencyKey(req);
    const result = await this.tenantInternalClient.updateTenantStatus(this.context(req, idempotencyKey), tenantId, body);
    await this.adminAuditService.record(req, {
      action: "admin.tenant.statusChanged",
      resourceType: "tenant",
      resourceId: tenantId,
      details: {
        tenantId,
        code: result.code,
        status: result.status
      }
    });
    return this.success(req, result);
  }

  @AdminPermission("tenant.modules.manage")
  @Put(":tenantId/modules")
  async replaceModules(@Param("tenantId") tenantId: string, @Body() body: unknown, @Req() req: AdminBffRequest) {
    this.assertSystemAdmin(req);
    const idempotencyKey = requireIdempotencyKey(req);
    const result = await this.tenantInternalClient.replaceTenantModules(this.context(req, idempotencyKey), tenantId, body);
    await this.adminAuditService.record(req, {
      action: "admin.tenant.modulesReplaced",
      resourceType: "tenant",
      resourceId: tenantId,
      details: {
        tenantId,
        enabledModules: result.enabledModules
      }
    });
    return this.success(req, result);
  }

  @AdminPermission("tenant.domains.read")
  @Get(":tenantId/domains")
  async listDomains(@Param("tenantId") tenantId: string, @Req() req: AdminBffRequest) {
    this.assertSystemAdmin(req);
    const result = await this.tenantInternalClient.listTenantDomains(this.context(req), tenantId);
    return this.success(req, result);
  }

  @AdminPermission("tenant.domains.manage")
  @HttpCode(201)
  @Post(":tenantId/domains")
  async addDomain(@Param("tenantId") tenantId: string, @Body() body: unknown, @Req() req: AdminBffRequest) {
    this.assertSystemAdmin(req);
    const idempotencyKey = requireIdempotencyKey(req);
    const result = await this.tenantInternalClient.addTenantDomain(this.context(req, idempotencyKey), tenantId, body);
    await this.adminAuditService.record(req, {
      action: "admin.tenantDomain.created",
      resourceType: "tenant_domain",
      resourceId: result.domainId,
      details: {
        tenantId,
        domainId: result.domainId,
        status: result.status
      }
    });
    return this.success(req, result);
  }

  @AdminPermission("tenant.domains.manage")
  @Delete(":tenantId/domains/:domainId")
  async deleteDomain(
    @Param("tenantId") tenantId: string,
    @Param("domainId") domainId: string,
    @Req() req: AdminBffRequest
  ) {
    this.assertSystemAdmin(req);
    const idempotencyKey = requireIdempotencyKey(req);
    const result = await this.tenantInternalClient.deleteTenantDomain(
      this.context(req, idempotencyKey),
      tenantId,
      domainId
    );
    await this.adminAuditService.record(req, {
      action: "admin.tenantDomain.disabled",
      resourceType: "tenant_domain",
      resourceId: domainId,
      details: {
        tenantId,
        domainId
      }
    });
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

  private assertSystemAdmin(req: AdminBffRequest) {
    if (!req.context.tenantId) {
      return;
    }

    throw new ForbiddenException({
      code: "AUTH_ADMIN_SCOPE_MISMATCH",
      message: "Customer management APIs require system administrator scope.",
      details: {
        requiredScope: "system_admin",
        currentScope: "tenant_admin"
      }
    });
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

import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, Put, Query, Req } from "@nestjs/common";

import { AdminAuditService } from "../audit/admin-audit.service.js";
import { AdminPermission } from "../auth/admin-permission.decorator.js";
import { authIamContext, success } from "../auth/admin-controller-utils.js";
import { requireIdempotencyKey } from "../auth/idempotency.js";
import type { AdminBffRequest } from "../context/request-context.js";
import { AuthIamInternalClient } from "../internal-clients/auth-iam-internal.client.js";

@Controller("api/admin")
export class AdminRbacController {
  constructor(
    @Inject(AuthIamInternalClient)
    private readonly authIamInternalClient: AuthIamInternalClient,
    @Inject(AdminAuditService)
    private readonly adminAuditService: AdminAuditService
  ) {}

  @AdminPermission("auth.permissions.read")
  @Get("permissions")
  async listPermissions(@Query() query: Record<string, unknown>, @Req() req: AdminBffRequest) {
    return success(req, await this.authIamInternalClient.listPermissions(authIamContext(req), query));
  }

  @AdminPermission("auth.permissions.create")
  @HttpCode(201)
  @Post("permissions")
  async createPermission(@Body() body: unknown, @Req() req: AdminBffRequest) {
    const idempotencyKey = requireIdempotencyKey(req);
    const result = await this.authIamInternalClient.createPermission(authIamContext(req, idempotencyKey), body);
    const permissionId = this.readStringField(result, "id") ?? "unknown";
    await this.adminAuditService.record(req, {
      action: "admin.permission.created",
      resourceType: "permission",
      resourceId: permissionId,
      details: {
        permissionId,
        code: this.readStringField(result, "code")
      }
    });
    return success(req, result);
  }

  @AdminPermission("auth.permissions.read")
  @Get("permissions/:permissionId")
  async getPermission(@Param("permissionId") permissionId: string, @Req() req: AdminBffRequest) {
    return success(req, await this.authIamInternalClient.getPermission(authIamContext(req), permissionId));
  }

  @AdminPermission("auth.roles.read")
  @Get("roles")
  async listRoles(@Query() query: Record<string, unknown>, @Req() req: AdminBffRequest) {
    return success(req, await this.authIamInternalClient.listRoles(authIamContext(req), query));
  }

  @AdminPermission("auth.roles.create")
  @HttpCode(201)
  @Post("roles")
  async createRole(@Body() body: unknown, @Req() req: AdminBffRequest) {
    const idempotencyKey = requireIdempotencyKey(req);
    const result = await this.authIamInternalClient.createRole(authIamContext(req, idempotencyKey), body);
    const roleId = this.readStringField(result, "id") ?? "unknown";
    await this.adminAuditService.record(req, {
      action: "admin.role.created",
      resourceType: "role",
      resourceId: roleId,
      details: {
        roleId,
        code: this.readStringField(result, "code")
      }
    });
    return success(req, result);
  }

  @AdminPermission("auth.roles.read")
  @Get("roles/:roleId")
  async getRole(@Param("roleId") roleId: string, @Req() req: AdminBffRequest) {
    return success(req, await this.authIamInternalClient.getRole(authIamContext(req), roleId));
  }

  @AdminPermission("auth.roles.update")
  @Patch("roles/:roleId")
  async updateRole(@Param("roleId") roleId: string, @Body() body: unknown, @Req() req: AdminBffRequest) {
    const idempotencyKey = requireIdempotencyKey(req);
    const result = await this.authIamInternalClient.updateRole(authIamContext(req, idempotencyKey), roleId, body);
    await this.adminAuditService.record(req, {
      action: "admin.role.updated",
      resourceType: "role",
      resourceId: roleId,
      details: {
        roleId,
        code: this.readStringField(result, "code")
      }
    });
    return success(req, result);
  }

  @AdminPermission("auth.rolePermissions.manage")
  @Put("roles/:roleId/permissions")
  async replaceRolePermissions(
    @Param("roleId") roleId: string,
    @Body() body: unknown,
    @Req() req: AdminBffRequest
  ) {
    const idempotencyKey = requireIdempotencyKey(req);
    const result = await this.authIamInternalClient.replaceRolePermissions(authIamContext(req, idempotencyKey), roleId, body);
    await this.adminAuditService.record(req, {
      action: "admin.role.permissionsReplaced",
      resourceType: "role",
      resourceId: roleId,
      details: {
        roleId,
        code: this.readStringField(result, "code"),
        permissions: this.readStringArrayField(result, "permissions")
      }
    });
    return success(req, result);
  }

  private readStringField(value: unknown, field: string): string | undefined {
    if (!value || typeof value !== "object" || !(field in value)) {
      return undefined;
    }

    const fieldValue = (value as Record<string, unknown>)[field];
    return typeof fieldValue === "string" ? fieldValue : undefined;
  }

  private readStringArrayField(value: unknown, field: string): string[] | undefined {
    if (!value || typeof value !== "object" || !(field in value)) {
      return undefined;
    }

    const fieldValue = (value as Record<string, unknown>)[field];
    if (!Array.isArray(fieldValue)) {
      return undefined;
    }

    return fieldValue.filter((item): item is string => typeof item === "string");
  }
}

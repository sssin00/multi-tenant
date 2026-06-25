import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Query, Req } from "@nestjs/common";

import { AdminAuditService } from "../audit/admin-audit.service.js";
import { AdminPermission } from "../auth/admin-permission.decorator.js";
import { authIamContext, success } from "../auth/admin-controller-utils.js";
import { requireIdempotencyKey } from "../auth/idempotency.js";
import type { AdminBffRequest } from "../context/request-context.js";
import { AuthIamInternalClient } from "../internal-clients/auth-iam-internal.client.js";

@Controller("api/admin")
export class AdminUsersController {
  constructor(
    @Inject(AuthIamInternalClient)
    private readonly authIamInternalClient: AuthIamInternalClient,
    @Inject(AdminAuditService)
    private readonly adminAuditService: AdminAuditService
  ) {}

  @AdminPermission("auth.users.read")
  @Get("users")
  async list(@Query() query: Record<string, unknown>, @Req() req: AdminBffRequest) {
    return success(req, await this.authIamInternalClient.listUsers(authIamContext(req), query));
  }

  @AdminPermission("auth.users.create")
  @HttpCode(201)
  @Post("users")
  async create(@Body() body: unknown, @Req() req: AdminBffRequest) {
    const idempotencyKey = requireIdempotencyKey(req);
    const result = await this.authIamInternalClient.createUser(authIamContext(req, idempotencyKey), body);
    const userId = this.readStringField(result, "id") ?? "unknown";
    await this.adminAuditService.record(req, {
      action: "admin.user.created",
      resourceType: "auth_user",
      resourceId: userId,
      details: {
        userId,
        userType: this.readStringField(result, "userType"),
        status: this.readStringField(result, "status")
      }
    });
    return success(req, result);
  }

  @AdminPermission("auth.users.read")
  @Get("users/:userId")
  async get(@Param("userId") userId: string, @Req() req: AdminBffRequest) {
    const context = authIamContext(req);
    const [user, roles] = await Promise.all([
      this.authIamInternalClient.getUser(context, userId),
      this.authIamInternalClient.listUserRoles(context, userId)
    ]);

    return success(req, {
      user,
      roles
    });
  }

  @AdminPermission("auth.users.update")
  @Patch("users/:userId")
  async update(@Param("userId") userId: string, @Body() body: unknown, @Req() req: AdminBffRequest) {
    const idempotencyKey = requireIdempotencyKey(req);
    const result = await this.authIamInternalClient.updateUser(authIamContext(req, idempotencyKey), userId, body);
    await this.adminAuditService.record(req, {
      action: "admin.user.updated",
      resourceType: "auth_user",
      resourceId: userId,
      details: {
        userId,
        status: this.readStringField(result, "status")
      }
    });
    return success(req, result);
  }

  @AdminPermission("auth.users.updateStatus")
  @Patch("users/:userId/status")
  async updateStatus(@Param("userId") userId: string, @Body() body: unknown, @Req() req: AdminBffRequest) {
    const idempotencyKey = requireIdempotencyKey(req);
    const result = await this.authIamInternalClient.updateUserStatus(authIamContext(req, idempotencyKey), userId, body);
    await this.adminAuditService.record(req, {
      action: "admin.user.statusChanged",
      resourceType: "auth_user",
      resourceId: userId,
      details: {
        userId,
        status: this.readStringField(result, "status")
      }
    });
    return success(req, result);
  }

  @AdminPermission("auth.users.delete")
  @Delete("users/:userId")
  async remove(@Param("userId") userId: string, @Req() req: AdminBffRequest) {
    const idempotencyKey = requireIdempotencyKey(req);
    const result = await this.authIamInternalClient.deleteUser(authIamContext(req, idempotencyKey), userId);
    await this.adminAuditService.record(req, {
      action: "admin.user.deleted",
      resourceType: "auth_user",
      resourceId: userId,
      details: {
        userId,
        status: this.readStringField(result, "status")
      }
    });
    return success(req, result);
  }

  @AdminPermission("auth.userRoles.manage")
  @Get("users/:userId/roles")
  async listUserRoles(@Param("userId") userId: string, @Req() req: AdminBffRequest) {
    return success(req, await this.authIamInternalClient.listUserRoles(authIamContext(req), userId));
  }

  @AdminPermission("auth.userRoles.manage")
  @HttpCode(201)
  @Post("users/:userId/roles")
  async assignUserRole(@Param("userId") userId: string, @Body() body: unknown, @Req() req: AdminBffRequest) {
    const idempotencyKey = requireIdempotencyKey(req);
    const result = await this.authIamInternalClient.assignUserRole(authIamContext(req, idempotencyKey), userId, body);
    const userRoleId = this.readStringField(result, "id") ?? "unknown";
    await this.adminAuditService.record(req, {
      action: "admin.userRole.assigned",
      resourceType: "user_role",
      resourceId: userRoleId,
      details: {
        userId,
        userRoleId,
        roleId: this.readStringField(result, "roleId"),
        roleCode: this.readStringField(result, "roleCode"),
        warehouseId: this.readStringField(result, "warehouseId")
      }
    });
    return success(req, result);
  }

  @AdminPermission("auth.userRoles.manage")
  @Delete("user-roles/:userRoleId")
  async removeUserRole(@Param("userRoleId") userRoleId: string, @Req() req: AdminBffRequest) {
    const idempotencyKey = requireIdempotencyKey(req);
    const result = await this.authIamInternalClient.removeUserRole(authIamContext(req, idempotencyKey), userRoleId);
    await this.adminAuditService.record(req, {
      action: "admin.userRole.removed",
      resourceType: "user_role",
      resourceId: userRoleId,
      details: {
        userRoleId
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
}

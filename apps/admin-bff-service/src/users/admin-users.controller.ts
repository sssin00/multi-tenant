import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Query, Req } from "@nestjs/common";

import { AdminPermission } from "../auth/admin-permission.decorator.js";
import { authIamContext, success } from "../auth/admin-controller-utils.js";
import { requireIdempotencyKey } from "../auth/idempotency.js";
import type { AdminBffRequest } from "../context/request-context.js";
import { AuthIamInternalClient } from "../internal-clients/auth-iam-internal.client.js";

@Controller("api/admin")
export class AdminUsersController {
  constructor(
    @Inject(AuthIamInternalClient)
    private readonly authIamInternalClient: AuthIamInternalClient
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
    return success(req, await this.authIamInternalClient.createUser(authIamContext(req, idempotencyKey), body));
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
    return success(req, await this.authIamInternalClient.updateUser(authIamContext(req, idempotencyKey), userId, body));
  }

  @AdminPermission("auth.users.updateStatus")
  @Patch("users/:userId/status")
  async updateStatus(@Param("userId") userId: string, @Body() body: unknown, @Req() req: AdminBffRequest) {
    const idempotencyKey = requireIdempotencyKey(req);
    return success(
      req,
      await this.authIamInternalClient.updateUserStatus(authIamContext(req, idempotencyKey), userId, body)
    );
  }

  @AdminPermission("auth.users.delete")
  @Delete("users/:userId")
  async remove(@Param("userId") userId: string, @Req() req: AdminBffRequest) {
    const idempotencyKey = requireIdempotencyKey(req);
    return success(req, await this.authIamInternalClient.deleteUser(authIamContext(req, idempotencyKey), userId));
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
    return success(
      req,
      await this.authIamInternalClient.assignUserRole(authIamContext(req, idempotencyKey), userId, body)
    );
  }

  @AdminPermission("auth.userRoles.manage")
  @Delete("user-roles/:userRoleId")
  async removeUserRole(@Param("userRoleId") userRoleId: string, @Req() req: AdminBffRequest) {
    const idempotencyKey = requireIdempotencyKey(req);
    return success(
      req,
      await this.authIamInternalClient.removeUserRole(authIamContext(req, idempotencyKey), userRoleId)
    );
  }
}

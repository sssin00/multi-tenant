import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Put, Query, Req } from "@nestjs/common";

import type { AuthIamRequest } from "../context/request-context.js";
import { InternalService } from "../internal-auth/internal-service.decorator.js";
import { PermissionsService } from "./permissions.service.js";
import { RbacService } from "./rbac.service.js";

@Controller("api/v1/auth")
export class PermissionsController {
  constructor(
    @Inject(PermissionsService)
    private readonly permissionsService: PermissionsService,
    @Inject(RbacService)
    private readonly rbacService: RbacService
  ) {}

  @HttpCode(201)
  @Post("permissions")
  async createPermission(@Body() body: unknown, @Req() req: AuthIamRequest) {
    return this.success(req, await this.permissionsService.create(req.context, body));
  }

  @Get("permissions")
  async listPermissions(@Query() query: Record<string, unknown>, @Req() req: AuthIamRequest) {
    return this.success(req, await this.permissionsService.list(query));
  }

  @Get("permissions/summary")
  @InternalService({
    allowedServices: ["admin-bff-service", "user-bff-service"]
  })
  async summary(@Query() query: Record<string, unknown>, @Req() req: AuthIamRequest) {
    return this.success(req, await this.rbacService.summary(req.context, query));
  }

  @HttpCode(200)
  @Post("permissions/check")
  @InternalService({
    allowedServices: ["admin-bff-service", "user-bff-service", "wms-service"]
  })
  async check(@Body() body: unknown, @Req() req: AuthIamRequest) {
    return this.success(req, await this.rbacService.check(req.context, body));
  }

  @Get("permissions/:permissionId")
  async getPermission(@Param("permissionId") permissionId: string, @Req() req: AuthIamRequest) {
    return this.success(req, await this.permissionsService.get(permissionId));
  }

  @HttpCode(201)
  @Post("roles")
  async createRole(@Body() body: unknown, @Req() req: AuthIamRequest) {
    return this.success(req, await this.rbacService.createRole(req.context, body));
  }

  @Get("roles")
  async listRoles(@Query() query: Record<string, unknown>, @Req() req: AuthIamRequest) {
    return this.success(req, await this.rbacService.listRoles(req.context, query));
  }

  @Get("roles/:roleId")
  async getRole(@Param("roleId") roleId: string, @Req() req: AuthIamRequest) {
    return this.success(req, await this.rbacService.getRole(req.context, roleId));
  }

  @Patch("roles/:roleId")
  async updateRole(@Param("roleId") roleId: string, @Body() body: unknown, @Req() req: AuthIamRequest) {
    return this.success(req, await this.rbacService.updateRole(req.context, roleId, body));
  }

  @Put("roles/:roleId/permissions")
  async replaceRolePermissions(@Param("roleId") roleId: string, @Body() body: unknown, @Req() req: AuthIamRequest) {
    return this.success(req, await this.rbacService.replaceRolePermissions(req.context, roleId, body));
  }

  @HttpCode(201)
  @Post("users/:userId/roles")
  async assignUserRole(@Param("userId") userId: string, @Body() body: unknown, @Req() req: AuthIamRequest) {
    return this.success(req, await this.rbacService.assignUserRole(req.context, userId, body));
  }

  @Get("users/:userId/roles")
  async listUserRoles(@Param("userId") userId: string, @Req() req: AuthIamRequest) {
    return this.success(req, await this.rbacService.listUserRoles(req.context, userId));
  }

  @Delete("user-roles/:userRoleId")
  async removeUserRole(@Param("userRoleId") userRoleId: string, @Req() req: AuthIamRequest) {
    return this.success(req, await this.rbacService.removeUserRole(req.context, userRoleId));
  }

  private success(req: AuthIamRequest, data: unknown) {
    return {
      success: true,
      requestId: req.context.requestId,
      timestamp: new Date().toISOString(),
      data
    };
  }
}

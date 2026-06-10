import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Query, Req } from "@nestjs/common";

import type { AuthIamRequest } from "../context/request-context.js";
import { UsersService } from "./users.service.js";

@Controller("api/auth/users")
export class UsersController {
  constructor(
    @Inject(UsersService)
    private readonly usersService: UsersService
  ) {}

  @HttpCode(201)
  @Post()
  async create(@Body() body: unknown, @Req() req: AuthIamRequest) {
    const result = await this.usersService.create({
      body,
      tenantId: req.context.tenantId,
      userId: req.context.userId,
      requestId: req.context.requestId
    });

    return this.success(req, result);
  }

  @Get()
  async list(@Query() query: Record<string, unknown>, @Req() req: AuthIamRequest) {
    const result = await this.usersService.list({
      ...query,
      tenantId: req.context.tenantId,
      userId: req.context.userId,
      requestId: req.context.requestId
    });

    return this.success(req, result);
  }

  @Get(":userId")
  async get(@Param("userId") userIdParam: string, @Req() req: AuthIamRequest) {
    const result = await this.usersService.get({
      userIdParam,
      tenantId: req.context.tenantId,
      userId: req.context.userId,
      requestId: req.context.requestId
    });

    return this.success(req, result);
  }

  @Patch(":userId")
  async update(@Param("userId") userIdParam: string, @Body() body: unknown, @Req() req: AuthIamRequest) {
    const result = await this.usersService.update({
      userIdParam,
      body,
      tenantId: req.context.tenantId,
      userId: req.context.userId,
      requestId: req.context.requestId
    });

    return this.success(req, result);
  }

  @Patch(":userId/status")
  async updateStatus(@Param("userId") userIdParam: string, @Body() body: unknown, @Req() req: AuthIamRequest) {
    const result = await this.usersService.updateStatus({
      userIdParam,
      body,
      tenantId: req.context.tenantId,
      userId: req.context.userId,
      requestId: req.context.requestId
    });

    return this.success(req, result);
  }

  @Delete(":userId")
  async remove(@Param("userId") userIdParam: string, @Req() req: AuthIamRequest) {
    const result = await this.usersService.remove({
      userIdParam,
      tenantId: req.context.tenantId,
      userId: req.context.userId,
      requestId: req.context.requestId
    });

    return this.success(req, result);
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

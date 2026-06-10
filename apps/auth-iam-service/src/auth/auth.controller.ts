import { Body, Controller, Get, HttpCode, Inject, Post, Req } from "@nestjs/common";

import type { AuthIamRequest } from "../context/request-context.js";
import { AuthService } from "./auth.service.js";
import { Public } from "./public.decorator.js";

@Controller("api/auth")
export class AuthController {
  constructor(
    @Inject(AuthService)
    private readonly authService: AuthService
  ) {}

  @Public()
  @HttpCode(200)
  @Post("login")
  async login(@Body() body: unknown, @Req() req: AuthIamRequest) {
    const result = await this.authService.login({
      ...(typeof body === "object" && body !== null ? body : {}),
      headerTenantId: req.context.tenantId
    });

    req.context.tenantId ??= typeof body === "object" && body !== null && "tenantId" in body
      ? String((body as { tenantId?: unknown }).tenantId)
      : undefined;

    return {
      success: true,
      requestId: req.context.requestId,
      timestamp: new Date().toISOString(),
      data: result
    };
  }

  @Public()
  @HttpCode(200)
  @Post("token/refresh")
  async refresh(@Body() body: unknown, @Req() req: AuthIamRequest) {
    const result = await this.authService.refresh({
      ...(typeof body === "object" && body !== null ? body : {}),
      headerTenantId: req.context.tenantId
    });

    req.context.tenantId ??= result.accessToken ? this.readTenantId(body) : undefined;

    return this.success(req, result);
  }

  @Get("me")
  async me(@Req() req: AuthIamRequest) {
    return this.success(req, await this.authService.me(req.context));
  }

  @HttpCode(200)
  @Post("logout")
  async logout(@Body() body: unknown, @Req() req: AuthIamRequest) {
    const result = await this.authService.revoke({
      ...(typeof body === "object" && body !== null ? body : {}),
      headerTenantId: req.context.tenantId,
      userId: req.context.userId
    });

    req.context.tenantId ??= this.readTenantId(body);

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

  private readTenantId(body: unknown): string | undefined {
    return typeof body === "object" && body !== null && "tenantId" in body
      ? String((body as { tenantId?: unknown }).tenantId)
      : undefined;
  }
}

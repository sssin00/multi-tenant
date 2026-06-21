import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { RequestWithContext } from "../context/request-context.js";
import { AuthIamInternalClient } from "../internal-clients/auth-iam-internal.client.js";
import { APP_PERMISSION_METADATA } from "./app-permission.decorator.js";

@Injectable()
export class AppPermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authClient: AuthIamInternalClient
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const permission = this.reflector.getAllAndOverride<string>(APP_PERMISSION_METADATA, [
      context.getHandler(),
      context.getClass()
    ]);

    if (!permission) {
      return true;
    }

    const req = context.switchToHttp().getRequest<RequestWithContext>();
    const requestContext = req.context;
    if (!requestContext) {
      return false;
    }

    const result = await this.authClient.checkPermission(requestContext, permission);
    if (result.allowed) {
      return true;
    }

    throw new ForbiddenException({
      success: false,
      requestId: requestContext.requestId,
      timestamp: new Date().toISOString(),
      error: {
        code: "FORBIDDEN",
        message: "Permission is required",
        details: { permission }
      }
    });
  }
}

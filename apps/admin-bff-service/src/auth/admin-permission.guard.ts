import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";

import type { AdminBffRequest } from "../context/request-context.js";
import { AuthIamInternalClient } from "../internal-clients/auth-iam-internal.client.js";
import { ADMIN_PERMISSION, type AdminPermissionOptions } from "./admin-permission.decorator.js";

@Injectable()
export class AdminPermissionGuard implements CanActivate {
  constructor(
    @Inject(Reflector)
    private readonly reflector: Reflector,
    @Inject(AuthIamInternalClient)
    private readonly authIamInternalClient: AuthIamInternalClient
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.getAllAndOverride<AdminPermissionOptions | undefined>(ADMIN_PERMISSION, [
      context.getHandler(),
      context.getClass()
    ]);

    if (!options) {
      return true;
    }

    const req = context.switchToHttp().getRequest<AdminBffRequest>();
    const tenantId = req.context?.tenantId;
    const userId = req.context?.userId;

    if (!tenantId) {
      throw new BadRequestException({
        code: "TENANT_REQUIRED",
        message: "Tenant context is required"
      });
    }

    if (!userId) {
      throw new UnauthorizedException({
        code: "UNAUTHORIZED",
        message: "User context is required"
      });
    }

    const permissions = Array.isArray(options.permission) ? options.permission : [options.permission];
    const scope = this.readScope(req, options);
    const results = await Promise.all(
      permissions.map((permission) =>
        this.authIamInternalClient.checkPermission({
          requestId: req.context.requestId,
          tenantId,
          userId,
          permission,
          scope
        })
      )
    );

    const deniedResult = results.find((result) => !result.allowed);
    if (deniedResult) {
      throw new ForbiddenException({
        code: "FORBIDDEN",
        message: "Permission denied",
        details: {
          permission: deniedResult.permission,
          scope: deniedResult.scope
        }
      });
    }

    return true;
  }

  private readScope(req: AdminBffRequest, options: AdminPermissionOptions): { warehouseId?: string } | undefined {
    if (!options.warehouseIdParam) {
      return undefined;
    }

    const paramValue = req.params[options.warehouseIdParam];
    const value = Array.isArray(paramValue) ? paramValue[0] : paramValue;
    if (!value) {
      return undefined;
    }

    return {
      warehouseId: value
    };
  }
}

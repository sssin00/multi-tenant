import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  ServiceUnavailableException
} from "@nestjs/common";

import type { AdminBffRequest } from "../context/request-context.js";
import { TenantInternalClient } from "../internal-clients/tenant-internal.client.js";

const ACTIVE_TENANT_STATUS = "active";
const SKIP_PATHS = new Set(["/health", "/ready"]);

@Injectable()
export class TenantStatusGuard implements CanActivate {
  constructor(
    @Inject(TenantInternalClient)
    private readonly tenantInternalClient: TenantInternalClient
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AdminBffRequest>();
    const tenantId = req.context?.tenantId;

    if (!tenantId || SKIP_PATHS.has(req.path)) {
      return true;
    }

    try {
      const tenant = await this.tenantInternalClient.getTenantStatus(
        {
          requestId: req.context.requestId,
          tenantId,
          userId: req.context.userId
        },
        tenantId
      );

      if (tenant.status !== ACTIVE_TENANT_STATUS) {
        throw new ForbiddenException({
          code: "TENANT_NOT_READY",
          message: "Tenant is not active",
          details: {
            tenantId,
            status: tenant.status
          }
        });
      }

      return true;
    } catch (error) {
      if (error instanceof ForbiddenException) {
        throw error;
      }

      throw new ServiceUnavailableException({
        code: "TENANT_STATUS_UNAVAILABLE",
        message: "Tenant status check is unavailable",
        details: {
          tenantId
        }
      });
    }
  }
}

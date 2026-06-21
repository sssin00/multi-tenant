import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException
} from "@nestjs/common";
import type { RequestWithContext } from "../context/request-context.js";
import { TenantInternalClient } from "../internal-clients/tenant-internal.client.js";

@Injectable()
export class TenantStatusGuard implements CanActivate {
  constructor(private readonly tenantClient: TenantInternalClient) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RequestWithContext>();
    const requestContext = req.context;

    if (!requestContext?.tenantId) {
      throw new BadRequestException({
        success: false,
        requestId: requestContext?.requestId ?? "unknown",
        timestamp: new Date().toISOString(),
        error: {
          code: "TENANT_REQUIRED",
          message: "Tenant context is required"
        }
      });
    }

    try {
      const tenant = await this.tenantClient.getTenantStatus(requestContext, requestContext.tenantId);
      if (tenant.status !== "active") {
        throw new ForbiddenException({
          success: false,
          requestId: requestContext.requestId,
          timestamp: new Date().toISOString(),
          error: {
            code: "TENANT_NOT_READY",
            message: "Tenant is not active"
          }
        });
      }

      return true;
    } catch (error) {
      if (error instanceof ForbiddenException || error instanceof BadRequestException) {
        throw error;
      }

      throw new ServiceUnavailableException({
        success: false,
        requestId: requestContext.requestId,
        timestamp: new Date().toISOString(),
        error: {
          code: "TENANT_STATUS_UNAVAILABLE",
          message: "Tenant status could not be verified"
        }
      });
    }
  }
}

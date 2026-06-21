import { Inject, Injectable } from "@nestjs/common";

import { InternalAuthSignerService } from "./internal-auth-signer.service.js";
import { InternalHttpClient } from "./internal-http-client.js";

export interface PermissionCheckCommand {
  requestId: string;
  tenantId: string;
  userId: string;
  permission: string;
  scope?: {
    warehouseId?: string;
  };
}

export interface PermissionCheckResult {
  allowed: boolean;
  userId: string;
  tenantId: string;
  permission: string;
  scope: {
    warehouseId: string | null;
  };
}

@Injectable()
export class AuthIamInternalClient extends InternalHttpClient {
  constructor(
    @Inject(InternalAuthSignerService)
    internalAuthSignerService: InternalAuthSignerService
  ) {
    super(internalAuthSignerService);
  }

  async checkPermission(command: PermissionCheckCommand): Promise<PermissionCheckResult> {
    return this.request<PermissionCheckResult>({
      target: "auth-iam-service",
      baseUrl: this.config.downstream.authIamServiceUrl,
      method: "POST",
      path: "/api/auth/permissions/check",
      requestId: command.requestId,
      tenantId: command.tenantId,
      userId: command.userId,
      body: {
        userId: command.userId,
        permission: command.permission,
        scope: command.scope ?? {}
      }
    });
  }
}

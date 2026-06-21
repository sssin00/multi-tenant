import { Inject, Injectable } from "@nestjs/common";

import { InternalAuthSignerService } from "./internal-auth-signer.service.js";
import { InternalHttpClient } from "./internal-http-client.js";

export interface TenantModulesCommand {
  requestId: string;
  tenantId: string;
  userId?: string;
}

export interface TenantModulesResponse {
  tenantId: string;
  status: string;
  enabledModules: string[];
}

@Injectable()
export class TenantInternalClient extends InternalHttpClient {
  constructor(
    @Inject(InternalAuthSignerService)
    internalAuthSignerService: InternalAuthSignerService
  ) {
    super(internalAuthSignerService);
  }

  async getTenantModules(command: TenantModulesCommand): Promise<TenantModulesResponse> {
    return this.request<TenantModulesResponse>({
      target: "tenant-service",
      baseUrl: this.config.downstream.tenantServiceUrl,
      method: "GET",
      path: `/internal/tenants/${encodeURIComponent(command.tenantId)}/modules`,
      requestId: command.requestId,
      tenantId: command.tenantId,
      userId: command.userId
    });
  }
}

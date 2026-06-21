import { Injectable } from "@nestjs/common";
import { loadAppConfig } from "../config/app.config.js";
import type { RequestContext } from "../context/request-context.js";
import { InternalHttpClient } from "./internal-http.client.js";

export type TenantStatus = "active" | "inactive" | "suspended" | "pending" | "deleted";

export interface TenantStatusSummary {
  tenantId: string;
  code: string;
  name: string;
  status: TenantStatus;
}

export interface TenantModuleSummary {
  tenantId: string;
  status: TenantStatus;
  enabledModules: string[];
}

@Injectable()
export class TenantInternalClient {
  private readonly config = loadAppConfig();

  constructor(private readonly http: InternalHttpClient) {}

  async getTenantStatus(context: RequestContext, tenantId: string): Promise<TenantStatusSummary> {
    return this.http.request<TenantStatusSummary>({
      target: "tenant",
      baseUrl: this.config.downstream.tenantServiceUrl,
      method: "GET",
      path: `/internal/tenants/${encodeURIComponent(tenantId)}/status`,
      context
    });
  }

  async getTenantModules(context: RequestContext, tenantId: string): Promise<TenantModuleSummary> {
    return this.http.request<TenantModuleSummary>({
      target: "tenant",
      baseUrl: this.config.downstream.tenantServiceUrl,
      method: "GET",
      path: `/internal/tenants/${encodeURIComponent(tenantId)}/modules`,
      context
    });
  }
}

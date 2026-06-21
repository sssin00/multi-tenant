import { Injectable } from "@nestjs/common";
import { loadAppConfig } from "../config/app.config.js";
import type { RequestContext } from "../context/request-context.js";
import { InternalHttpClient } from "./internal-http.client.js";

export interface PermissionSummary {
  userId: string;
  tenantId: string;
  roles: Array<{
    roleId: string;
    roleCode: string;
    warehouseId: string | null;
  }>;
  permissions: string[];
}

export interface PermissionCheckResult {
  allowed: boolean;
  permission: string;
}

@Injectable()
export class AuthIamInternalClient {
  private readonly config = loadAppConfig();

  constructor(private readonly http: InternalHttpClient) {}

  async getPermissionSummary(context: RequestContext): Promise<PermissionSummary> {
    const userId = this.requireUserId(context);
    const searchParams = new URLSearchParams({ userId });

    return this.http.request<PermissionSummary>({
      target: "authIam",
      baseUrl: this.config.downstream.authIamServiceUrl,
      method: "GET",
      path: `/permissions/summary?${searchParams.toString()}`,
      context
    });
  }

  async checkPermission(context: RequestContext, permission: string): Promise<PermissionCheckResult> {
    return this.http.request<PermissionCheckResult>({
      target: "authIam",
      baseUrl: this.config.downstream.authIamServiceUrl,
      method: "POST",
      path: "/permissions/check",
      context,
      body: {
        userId: this.requireUserId(context),
        permission
      }
    });
  }

  private requireUserId(context: RequestContext): string {
    if (!context.userId) {
      throw new Error("X-User-Id header is required for auth-iam requests");
    }

    return context.userId;
  }
}

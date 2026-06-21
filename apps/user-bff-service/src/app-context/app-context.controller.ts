import { BadRequestException, Controller, Get, Req, UseGuards } from "@nestjs/common";
import type { RequestWithContext } from "../context/request-context.js";
import { AppAuditService } from "../audit/app-audit.service.js";
import { AuthIamInternalClient, PermissionSummary } from "../internal-clients/auth-iam-internal.client.js";
import { TenantInternalClient } from "../internal-clients/tenant-internal.client.js";
import { TenantStatusGuard } from "../tenants/tenant-status.guard.js";
import { AppPermissionGuard } from "../auth/app-permission.guard.js";
import { successEnvelope, SuccessEnvelope } from "../auth/response-envelope.js";

interface UserProfileResponse {
  user: {
    userId: string;
  };
  tenant: {
    tenantId: string;
    code: string;
    name: string;
    status: string;
    enabledModules: string[];
  };
  permissions: PermissionSummary;
}

interface NavigationItem {
  id: string;
  label: string;
  path: string;
  requiredPermissions: string[];
}

interface NavigationResponse {
  items: NavigationItem[];
}

@Controller("api/app")
@UseGuards(TenantStatusGuard, AppPermissionGuard)
export class AppContextController {
  constructor(
    private readonly authClient: AuthIamInternalClient,
    private readonly tenantClient: TenantInternalClient,
    private readonly appAuditService: AppAuditService
  ) {}

  @Get("me")
  async getMe(@Req() req: RequestWithContext): Promise<SuccessEnvelope<UserProfileResponse>> {
    const context = this.requireContext(req);
    const [tenant, modules, permissions] = await Promise.all([
      this.tenantClient.getTenantStatus(context, context.tenantId),
      this.tenantClient.getTenantModules(context, context.tenantId),
      this.authClient.getPermissionSummary(context)
    ]);

    this.appAuditService.recordAppContextLoaded(context);

    return successEnvelope(context, {
      user: {
        userId: context.userId
      },
      tenant: {
        tenantId: tenant.tenantId,
        code: tenant.code,
        name: tenant.name,
        status: tenant.status,
        enabledModules: modules.enabledModules
      },
      permissions
    });
  }

  @Get("navigation")
  async getNavigation(@Req() req: RequestWithContext): Promise<SuccessEnvelope<NavigationResponse>> {
    const context = this.requireContext(req);
    const [modules, permissions] = await Promise.all([
      this.tenantClient.getTenantModules(context, context.tenantId),
      this.authClient.getPermissionSummary(context)
    ]);

    const items = this.buildNavigation(modules.enabledModules, permissions.permissions);
    this.appAuditService.recordNavigationLoaded(context, items.length);

    return successEnvelope(context, { items });
  }

  private requireContext(req: RequestWithContext): {
    requestId: string;
    tenantId: string;
    userId: string;
    authorization?: string;
  } {
    const context = req.context;
    if (!context?.tenantId || !context.userId) {
      throw new BadRequestException({
        success: false,
        requestId: context?.requestId ?? "unknown",
        timestamp: new Date().toISOString(),
        error: {
          code: "REQUEST_CONTEXT_REQUIRED",
          message: "Tenant and user context are required"
        }
      });
    }

    return {
      requestId: context.requestId,
      tenantId: context.tenantId,
      userId: context.userId,
      ...(context.authorization ? { authorization: context.authorization } : {})
    };
  }

  private buildNavigation(enabledModules: string[], permissions: string[]): NavigationItem[] {
    if (!enabledModules.includes("wms")) {
      return [];
    }

    const candidates: NavigationItem[] = [
      {
        id: "wms-dashboard",
        label: "WMS",
        path: "/wms",
        requiredPermissions: ["wms.inventory.read"]
      },
      {
        id: "wms-inventory",
        label: "Inventory",
        path: "/wms/inventory",
        requiredPermissions: ["wms.inventory.read"]
      },
      {
        id: "wms-warehouses",
        label: "Warehouses",
        path: "/wms/warehouses",
        requiredPermissions: ["wms.warehouses.manage"]
      },
      {
        id: "wms-materials",
        label: "Materials",
        path: "/wms/materials",
        requiredPermissions: ["wms.items.manage"]
      }
    ];

    return candidates.filter((item) =>
      item.requiredPermissions.some((permission) => permissions.includes(permission))
    );
  }
}

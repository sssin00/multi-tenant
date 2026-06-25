import { Controller, Get, Inject, Req } from "@nestjs/common";

import { authIamContext, success } from "../auth/admin-controller-utils.js";
import type { AdminBffRequest } from "../context/request-context.js";
import { AuthIamInternalClient } from "../internal-clients/auth-iam-internal.client.js";
import { TenantInternalClient } from "../internal-clients/tenant-internal.client.js";

interface AdminNavigationItem {
  key: string;
  label: string;
  path: string;
}

const NAVIGATION_RULES: Array<
  AdminNavigationItem & { permissions: string[]; mode?: "all" | "any"; systemOnly?: boolean }
> = [
  {
    key: "dashboard",
    label: "관리 대시보드",
    path: "/dashboard",
    permissions: []
  },
  {
    key: "tenants",
    label: "고객사 관리",
    path: "/tenants",
    permissions: ["tenant.tenants.read"],
    systemOnly: true
  },
  {
    key: "access-control",
    label: "사용자 관리",
    path: "/access-control",
    permissions: ["auth.users.read", "auth.roles.read", "auth.permissions.read"],
    mode: "all"
  },
  {
    key: "roles",
    label: "역할/권한",
    path: "/roles",
    permissions: ["auth.roles.read", "auth.permissions.read"],
    mode: "all"
  },
  {
    key: "audit-logs",
    label: "감사 로그",
    path: "/audit-logs",
    permissions: ["audit.logs.read"]
  },
  {
    key: "risk-actions",
    label: "위험 작업",
    path: "/risk-actions",
    permissions: [
      "tenant.tenants.updateStatus",
      "tenant.modules.manage",
      "tenant.domains.manage",
      "auth.users.updateStatus",
      "auth.userRoles.manage",
      "auth.rolePermissions.manage"
    ],
    mode: "any"
  }
];

@Controller("api/admin/me")
export class AdminMeController {
  constructor(
    @Inject(AuthIamInternalClient)
    private readonly authIamInternalClient: AuthIamInternalClient,
    @Inject(TenantInternalClient)
    private readonly tenantInternalClient: TenantInternalClient
  ) {}

  @Get()
  async getMe(@Req() req: AdminBffRequest) {
    const context = authIamContext(req);
    const me = await this.authIamInternalClient.getMe(context);

    if (!req.context.tenantId) {
      return success(req, {
        user: me.user,
        tenant: {
          tenantId: null,
          status: "system_admin"
        },
        roles: me.roles,
        permissions: me.permissions,
        enabledModules: ["admin"],
        navigation: buildNavigation(me.permissions, true)
      });
    }

    const [tenant, modules] = await Promise.all([
      this.tenantInternalClient.getTenantStatus(context, req.context.tenantId),
      this.tenantInternalClient.getTenantModules(context, req.context.tenantId)
    ]);

    return success(req, {
      user: me.user,
      tenant: {
        tenantId: tenant.tenantId,
        status: tenant.status
      },
      roles: me.roles,
      permissions: me.permissions,
      enabledModules: modules.enabledModules,
      navigation: buildNavigation(me.permissions, false)
    });
  }
}

function buildNavigation(permissions: string[], isSystemAdmin: boolean): AdminNavigationItem[] {
  const permissionSet = new Set(permissions);

  return NAVIGATION_RULES.filter((item) => {
    if (item.systemOnly && !isSystemAdmin) {
      return false;
    }

    if (item.permissions.length === 0) {
      return true;
    }

    if (item.mode === "all") {
      return item.permissions.every((permission) => permissionSet.has(permission));
    }

    return item.permissions.some((permission) => permissionSet.has(permission));
  }).map(({ key, label, path }) => ({ key, label, path }));
}

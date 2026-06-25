import { Controller, Get, Inject, Req } from "@nestjs/common";

import { AdminPermission } from "../auth/admin-permission.decorator.js";
import { authIamContext, success } from "../auth/admin-controller-utils.js";
import type { AdminBffRequest } from "../context/request-context.js";
import { AuditLogInternalClient } from "../internal-clients/audit-log-internal.client.js";
import { AuthIamInternalClient } from "../internal-clients/auth-iam-internal.client.js";
import type { TenantListItem } from "../internal-clients/tenant-internal.client.js";
import { TenantInternalClient } from "../internal-clients/tenant-internal.client.js";

interface PageData<T> {
  items: T[];
  page: number;
  size: number;
  total: number;
}

interface UserSummaryItem {
  status?: string;
}

interface RoleSummaryItem {
  code?: string;
  permissionCodes?: string[];
}

interface PermissionSummaryItem {
  code?: string;
}

@Controller("api/admin/dashboard")
export class AdminDashboardController {
  constructor(
    @Inject(AuthIamInternalClient)
    private readonly authIamInternalClient: AuthIamInternalClient,
    @Inject(TenantInternalClient)
    private readonly tenantInternalClient: TenantInternalClient,
    @Inject(AuditLogInternalClient)
    private readonly auditLogInternalClient: AuditLogInternalClient
  ) {}

  @AdminPermission(["tenant.tenants.read", "auth.users.read", "auth.roles.read", "auth.permissions.read", "audit.logs.read"])
  @Get()
  async getDashboard(@Req() req: AdminBffRequest) {
    const authContext = authIamContext(req);
    const tenantContext = {
      requestId: req.context.requestId,
      tenantId: req.context.tenantId,
      userId: req.context.userId
    };
    const auditContext = {
      requestId: req.context.requestId,
      tenantId: req.context.tenantId,
      userId: req.context.userId
    };

    const [permissionSummary, tenants, users, roles, permissions, auditLogs] = await Promise.all([
      this.authIamInternalClient.getPermissionSummary({
        requestId: req.context.requestId,
        tenantId: req.context.tenantId,
        userId: req.context.userId ?? ""
      }),
      this.tenantInternalClient.listTenants(tenantContext, { page: 1, size: 100 }),
      this.authIamInternalClient.listUsers(authContext, { page: 1, size: 20 }),
      this.authIamInternalClient.listRoles(authContext, { page: 1, size: 100 }),
      this.authIamInternalClient.listPermissions(authContext, { page: 1, size: 100 }),
      this.auditLogInternalClient.listAuditLogs(auditContext, { page: 1, size: 5 })
    ]);

    const userPage = toPageData<UserSummaryItem>(users);
    const rolePage = toPageData<RoleSummaryItem>(roles);
    const permissionPage = toPageData<PermissionSummaryItem>(permissions);
    const tenantStatusCounts = countBy(tenants.items, (tenant) => tenant.status);
    const moduleCounts = countModules(tenants.items);
    const lockedUsers = userPage.items.filter((user) => user.status === "locked").length;

    return success(req, {
      admin: {
        userId: req.context.userId,
        tenantId: req.context.tenantId,
        roles: permissionSummary.roles,
        permissions: permissionSummary.permissions
      },
      tenantSummary: {
        total: tenants.total,
        statusCounts: tenantStatusCounts,
        enabledModules: moduleCounts,
        recentItems: tenants.items.slice(0, 5)
      },
      accessSummary: {
        usersTotal: userPage.total,
        rolesTotal: rolePage.total,
        permissionsTotal: permissionPage.total,
        lockedUsers,
        roleSamples: rolePage.items.slice(0, 4),
        permissionSamples: permissionPage.items.slice(0, 5)
      },
      auditSummary: {
        total: auditLogs.total,
        recentItems: auditLogs.items
      },
      riskSummary: {
        provisioningTenants: tenantStatusCounts.provisioning ?? 0,
        suspendedTenants: tenantStatusCounts.suspended ?? 0,
        lockedUsers,
        failedAuditLogs: auditLogs.items.filter((item) => item.result !== "success").length
      }
    });
  }
}

function toPageData<T>(value: unknown): PageData<T> {
  const page = value as Partial<PageData<T>>;

  return {
    items: Array.isArray(page.items) ? page.items : [],
    page: typeof page.page === "number" ? page.page : 1,
    size: typeof page.size === "number" ? page.size : 0,
    total: typeof page.total === "number" ? page.total : Array.isArray(page.items) ? page.items.length : 0
  };
}

function countBy<T>(items: T[], readKey: (item: T) => string | undefined): Record<string, number> {
  return items.reduce<Record<string, number>>((counts, item) => {
    const key = readKey(item) ?? "unknown";
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

function countModules(items: TenantListItem[]): Record<string, number> {
  return items.reduce<Record<string, number>>((counts, tenant) => {
    for (const moduleName of tenant.enabledModules ?? []) {
      counts[moduleName] = (counts[moduleName] ?? 0) + 1;
    }

    return counts;
  }, {});
}

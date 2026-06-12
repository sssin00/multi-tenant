import { Controller, Get, Inject, Query, Req } from "@nestjs/common";

import { AdminPermission } from "../auth/admin-permission.decorator.js";
import { authIamContext, success } from "../auth/admin-controller-utils.js";
import type { AdminBffRequest } from "../context/request-context.js";
import { AuthIamInternalClient } from "../internal-clients/auth-iam-internal.client.js";

const DEFAULT_CATALOG_PAGE = "1";
const DEFAULT_CATALOG_SIZE = "100";

@Controller("api/admin/access-control")
export class AdminAccessControlScreenController {
  constructor(
    @Inject(AuthIamInternalClient)
    private readonly authIamInternalClient: AuthIamInternalClient
  ) {}

  @AdminPermission(["auth.users.read", "auth.roles.read", "auth.permissions.read"])
  @Get("screen-data")
  async getScreenData(@Query() query: Record<string, unknown>, @Req() req: AdminBffRequest) {
    const context = authIamContext(req);
    const [users, roles, permissions] = await Promise.all([
      this.authIamInternalClient.listUsers(context, this.userQuery(query)),
      this.authIamInternalClient.listRoles(context, this.roleQuery(query)),
      this.authIamInternalClient.listPermissions(context, this.permissionQuery(query))
    ]);

    return success(req, {
      users,
      roles,
      permissions
    });
  }

  private userQuery(query: Record<string, unknown>): Record<string, unknown> {
    return this.compact({
      page: query.page,
      size: query.size,
      status: query.userStatus ?? query.status,
      email: query.email
    });
  }

  private roleQuery(query: Record<string, unknown>): Record<string, unknown> {
    return this.compact({
      page: query.rolePage ?? DEFAULT_CATALOG_PAGE,
      size: query.roleSize ?? DEFAULT_CATALOG_SIZE,
      code: query.roleCode
    });
  }

  private permissionQuery(query: Record<string, unknown>): Record<string, unknown> {
    return this.compact({
      page: query.permissionPage ?? DEFAULT_CATALOG_PAGE,
      size: query.permissionSize ?? DEFAULT_CATALOG_SIZE,
      code: query.permissionCode
    });
  }

  private compact(query: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(Object.entries(query).filter(([, value]) => value !== undefined && value !== ""));
  }
}

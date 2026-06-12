import { Controller, Get, Inject, Query, Req } from "@nestjs/common";

import { AdminPermission } from "../auth/admin-permission.decorator.js";
import { success } from "../auth/admin-controller-utils.js";
import type { AdminBffRequest } from "../context/request-context.js";
import { AuditLogInternalClient } from "../internal-clients/audit-log-internal.client.js";

@Controller("api/admin/audit-logs")
export class AdminAuditLogsController {
  constructor(
    @Inject(AuditLogInternalClient)
    private readonly auditLogInternalClient: AuditLogInternalClient
  ) {}

  @AdminPermission("audit.logs.read")
  @Get()
  async list(@Query() query: Record<string, unknown>, @Req() req: AdminBffRequest) {
    return success(
      req,
      await this.auditLogInternalClient.listAuditLogs(
        {
          requestId: req.context.requestId,
          tenantId: req.context.tenantId,
          userId: req.context.userId
        },
        query
      )
    );
  }
}

import { Controller, Get, Inject, Query, Req } from "@nestjs/common";

import type { AuditRequest } from "../context/request-context.js";
import { InternalService } from "../internal-auth/internal-service.decorator.js";
import { AuditLogsService } from "./audit-logs.service.js";

@Controller("api/internal/audit/logs")
export class InternalAuditLogsController {
  constructor(
    @Inject(AuditLogsService)
    private readonly auditLogsService: AuditLogsService
  ) {}

  @InternalService({ allowedServices: ["admin-bff-service"] })
  @Get()
  async list(@Query() query: Record<string, unknown>, @Req() req: AuditRequest) {
    const result = await this.auditLogsService.list({
      ...query,
      tenantId: req.context.tenantId ?? this.readString(query.tenantId)
    });

    return this.success(req, result);
  }

  private success(req: AuditRequest, data: unknown) {
    return {
      success: true,
      requestId: req.context.requestId,
      timestamp: new Date().toISOString(),
      data
    };
  }

  private readString(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
  }
}

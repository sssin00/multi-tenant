import { Body, Controller, Get, Inject, Post, Query, Req } from "@nestjs/common";

import type { AuditRequest } from "../context/request-context.js";
import type { AuditEventCommand } from "../audit-events/audit-event.contract.js";
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

  @InternalService({ allowedServices: ["user-bff-service", "admin-bff-service"] })
  @Post()
  async record(@Body() body: AuditEventCommand, @Req() req: AuditRequest) {
    const result = await this.auditLogsService.recordFromEvent({
      ...body,
      tenantId: body.tenantId ?? req.context.tenantId,
      requestId: body.requestId ?? req.context.requestId
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

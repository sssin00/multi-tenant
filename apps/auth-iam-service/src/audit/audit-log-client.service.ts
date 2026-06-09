import { Injectable, ServiceUnavailableException } from "@nestjs/common";

import { getAppConfig } from "../config/app.config.js";

export interface AuditContext {
  tenantId?: string;
  userId?: string;
  requestId?: string;
}

export interface AuditLogCommand {
  context: AuditContext;
  action: string;
  resourceType: string;
  resourceId: string;
  result?: "success" | "failure";
  details?: Record<string, unknown>;
}

@Injectable()
export class AuditLogClientService {
  private readonly config = getAppConfig();

  async record(command: AuditLogCommand): Promise<void> {
    if (!this.config.audit.serviceUrl) {
      return;
    }

    if (!command.context.tenantId) {
      throw new ServiceUnavailableException({
        code: "AUDIT_CONTEXT_INCOMPLETE",
        message: "Audit tenant context is required"
      });
    }

    const response = await fetch(this.auditLogsUrl(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Request-Id": command.context.requestId ?? "unknown",
        "X-Tenant-Id": command.context.tenantId
      },
      body: JSON.stringify({
        occurredAt: new Date().toISOString(),
        tenantId: command.context.tenantId,
        actor: {
          type: command.context.userId ? "user" : "system",
          userId: command.context.userId ?? null
        },
        action: command.action,
        resource: {
          type: command.resourceType,
          id: command.resourceId
        },
        result: command.result ?? "success",
        requestId: command.context.requestId ?? "unknown",
        details: command.details ?? {}
      })
    });

    if (!response.ok) {
      throw new ServiceUnavailableException({
        code: "AUDIT_LOG_SERVICE_UNAVAILABLE",
        message: "Audit log service did not accept the record"
      });
    }
  }

  private auditLogsUrl(): string {
    return `${this.config.audit.serviceUrl?.replace(/\/$/, "")}/api/v1/internal/audit/logs`;
  }
}

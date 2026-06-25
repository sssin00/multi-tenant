import { randomUUID } from "node:crypto";

import { Injectable, Logger } from "@nestjs/common";

import type { AdminBffRequest } from "../context/request-context.js";
import { AuditLogInternalClient } from "../internal-clients/audit-log-internal.client.js";

interface AdminAuditInput {
  action: string;
  resourceType: string;
  resourceId: string;
  details?: Record<string, unknown>;
}

@Injectable()
export class AdminAuditService {
  private readonly logger = new Logger(AdminAuditService.name);

  constructor(private readonly auditLogInternalClient: AuditLogInternalClient) {}

  async record(req: AdminBffRequest, input: AdminAuditInput): Promise<void> {
    const tenantId = req.context.tenantId;
    const userId = req.context.userId;

    if (!tenantId || !userId) {
      return;
    }

    try {
      await this.auditLogInternalClient.recordAuditLog(
        {
          requestId: req.context.requestId,
          tenantId,
          userId
        },
        {
          eventId: randomUUID(),
          eventType: input.action,
          schemaVersion: 1,
          tenantId,
          requestId: req.context.requestId,
          occurredAt: new Date().toISOString(),
          source: "admin-bff-service",
          aggregateType: input.resourceType,
          aggregateId: input.resourceId,
          actor: {
            type: "user",
            userId
          },
          data: input.details
        }
      );
    } catch (error) {
      this.logger.warn(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: "warn",
          service: "admin-bff-service",
          requestId: req.context.requestId,
          tenantId,
          userId,
          operation: "record_admin_audit",
          action: input.action,
          resourceType: input.resourceType,
          resourceId: input.resourceId,
          message: error instanceof Error ? error.message : "Audit log write failed"
        })
      );
    }
  }
}

import { randomUUID } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import type { RequestContext } from "../context/request-context.js";
import { AppAuditPublisher } from "./app-audit.publisher.js";

interface RecordAppAuditInput {
  action: "userBff.appContext.loaded" | "userBff.navigation.loaded";
  aggregateType: "app_context" | "app_navigation";
  details?: Record<string, unknown>;
}

@Injectable()
export class AppAuditService {
  private readonly logger = new Logger(AppAuditService.name);

  constructor(private readonly auditPublisher: AppAuditPublisher) {}

  recordAppContextLoaded(context: Required<Pick<RequestContext, "requestId" | "tenantId" | "userId">>) {
    void this.record(context, {
      action: "userBff.appContext.loaded",
      aggregateType: "app_context",
      details: {
        surface: "app",
        endpoint: "/api/app/me"
      }
    });
  }

  recordNavigationLoaded(
    context: Required<Pick<RequestContext, "requestId" | "tenantId" | "userId">>,
    itemCount: number
  ) {
    void this.record(context, {
      action: "userBff.navigation.loaded",
      aggregateType: "app_navigation",
      details: {
        surface: "app",
        endpoint: "/api/app/navigation",
        itemCount
      }
    });
  }

  private async record(
    context: Required<Pick<RequestContext, "requestId" | "tenantId" | "userId">>,
    input: RecordAppAuditInput
  ) {
    try {
      await this.auditPublisher.publish(context, {
        eventId: randomUUID(),
        eventType: input.action,
        schemaVersion: 1,
        tenantId: context.tenantId,
        requestId: context.requestId,
        occurredAt: new Date().toISOString(),
        source: "user-bff-service",
        aggregateType: input.aggregateType,
        aggregateId: context.userId,
        actor: {
          type: "user",
          userId: context.userId
        },
        data: input.details
      });
    } catch (error) {
      this.logger.warn(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: "warn",
          service: "user-bff-service",
          requestId: context.requestId,
          tenantId: context.tenantId,
          userId: context.userId,
          operation: "record_app_audit",
          action: input.action,
          message: error instanceof Error ? error.message : "Audit log write failed"
        })
      );
    }
  }
}

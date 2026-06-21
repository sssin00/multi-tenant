import { Injectable } from "@nestjs/common";
import { loadAppConfig } from "../config/app.config.js";
import type { RequestContext } from "../context/request-context.js";
import { InternalHttpClient } from "./internal-http.client.js";

export interface AuditEventActor {
  type: "user" | "service" | "system";
  userId?: string;
  serviceId?: string;
}

export interface AuditEventCommand {
  eventId: string;
  eventType: string;
  schemaVersion: number;
  tenantId: string;
  requestId: string;
  occurredAt: string;
  source: "user-bff-service";
  aggregateType: string;
  aggregateId: string;
  actor: AuditEventActor;
  data?: Record<string, unknown>;
}

export interface RecordAuditLogResponse {
  auditId: string;
  recorded: true;
}

@Injectable()
export class AuditLogInternalClient {
  private readonly config = loadAppConfig();

  constructor(private readonly http: InternalHttpClient) {}

  async record(context: RequestContext, command: AuditEventCommand): Promise<RecordAuditLogResponse> {
    if (!this.config.downstream.auditLogServiceUrl) {
      throw new Error("AUDIT_LOG_SERVICE_URL is required when app audit publisher is internal-api");
    }

    return this.http.request<RecordAuditLogResponse>({
      target: "audit",
      baseUrl: this.config.downstream.auditLogServiceUrl,
      method: "POST",
      path: "/api/internal/audit/logs",
      context,
      body: command
    });
  }
}

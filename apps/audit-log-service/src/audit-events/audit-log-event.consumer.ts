import { Inject, Injectable } from "@nestjs/common";

import { AuditLogsService } from "../audit-logs/audit-logs.service.js";
import {
  type AuditEventCommand,
  type EventBridgeAuditEventEnvelope,
  type RecordAuditLogResponse,
  type SqsAuditEventEnvelope
} from "./audit-event.contract.js";

@Injectable()
export class AuditLogEventConsumer {
  constructor(
    @Inject(AuditLogsService)
    private readonly auditLogsService: AuditLogsService
  ) {}

  async handle(event: AuditEventCommand | EventBridgeAuditEventEnvelope): Promise<RecordAuditLogResponse> {
    return this.auditLogsService.recordFromEvent(this.readDetail(event));
  }

  async handleSqsEvent(event: SqsAuditEventEnvelope): Promise<RecordAuditLogResponse[]> {
    const records = Array.isArray(event.Records) ? event.Records : [];
    const results: RecordAuditLogResponse[] = [];

    for (const record of records) {
      results.push(await this.auditLogsService.recordFromEvent(this.readSqsRecordBody(record.body)));
    }

    return results;
  }

  private readDetail(event: AuditEventCommand | EventBridgeAuditEventEnvelope): AuditEventCommand {
    if (this.isRecord(event) && "detail" in event) {
      if (!this.isRecord(event.detail)) {
        return {};
      }

      return event.detail as AuditEventCommand;
    }

    return event as AuditEventCommand;
  }

  private readSqsRecordBody(body: unknown): AuditEventCommand {
    if (this.isRecord(body)) {
      return this.readDetail(body as AuditEventCommand | EventBridgeAuditEventEnvelope);
    }

    if (typeof body !== "string" || body.trim().length === 0) {
      return {};
    }

    try {
      const parsed = JSON.parse(body) as unknown;
      if (!this.isRecord(parsed)) {
        return {};
      }

      return this.readDetail(parsed as AuditEventCommand | EventBridgeAuditEventEnvelope);
    } catch {
      return {};
    }
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
}

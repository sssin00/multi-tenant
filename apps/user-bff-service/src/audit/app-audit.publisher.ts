import { Injectable } from "@nestjs/common";
import { EventBridgeClient, PutEventsCommand, type PutEventsCommandOutput } from "@aws-sdk/client-eventbridge";

import { loadAppConfig, type AppConfig } from "../config/app.config.js";
import type { RequestContext } from "../context/request-context.js";
import { AuditLogInternalClient, type AuditEventCommand, type RecordAuditLogResponse } from "../internal-clients/audit-log-internal.client.js";

export interface PublishAppAuditResult {
  publishedTarget: "eventbridge" | "internal-api" | "disabled";
  record?: RecordAuditLogResponse;
}

@Injectable()
export class AppAuditPublisher {
  private readonly config = loadAppConfig();
  private readonly eventBridgeClient =
    this.config.audit.publisherType === "eventbridge"
      ? new EventBridgeClient({
          region: this.config.awsRegion,
          endpoint: this.config.audit.eventBridgeEndpoint
        })
      : undefined;

  constructor(private readonly auditLogClient: AuditLogInternalClient) {}

  async publish(context: RequestContext, command: AuditEventCommand): Promise<PublishAppAuditResult> {
    if (this.config.audit.publisherType === "disabled") {
      return { publishedTarget: "disabled" };
    }

    if (this.config.audit.publisherType === "internal-api") {
      return {
        publishedTarget: "internal-api",
        record: await this.auditLogClient.record(context, command)
      };
    }

    await this.publishToEventBridge(command);
    return { publishedTarget: "eventbridge" };
  }

  private async publishToEventBridge(command: AuditEventCommand): Promise<void> {
    if (!this.config.audit.eventBridgeBusName || !this.eventBridgeClient) {
      throw new Error("USER_BFF_AUDIT_EVENTBRIDGE_BUS_NAME is required when app audit publisher is eventbridge");
    }

    const response = await this.eventBridgeClient.send(
      new PutEventsCommand({
        Entries: [
          {
            EventBusName: this.config.audit.eventBridgeBusName,
            Source: buildEventBridgeSource(this.config, command.source),
            DetailType: command.eventType,
            Detail: JSON.stringify(command),
            Time: new Date(command.occurredAt)
          }
        ]
      })
    );

    assertEventBridgePublished(command.eventId, response);
  }
}

function buildEventBridgeSource(config: AppConfig, eventSource: string): string {
  const normalizedPrefix = config.audit.eventSourcePrefix.trim().replace(/\.+$/u, "");
  const normalizedSource = eventSource.trim().replace(/^\.+/u, "");

  return normalizedPrefix ? `${normalizedPrefix}.${normalizedSource}` : normalizedSource;
}

function assertEventBridgePublished(eventId: string, response: PutEventsCommandOutput): void {
  if (!response.FailedEntryCount) {
    return;
  }

  const failedEntry = response.Entries?.find((entry: { ErrorCode?: string; ErrorMessage?: string }) => entry.ErrorCode || entry.ErrorMessage);
  const reason = [failedEntry?.ErrorCode, failedEntry?.ErrorMessage].filter(Boolean).join(": ");
  throw new Error(`Failed to publish app audit event ${eventId} to EventBridge${reason ? `: ${reason}` : ""}`);
}

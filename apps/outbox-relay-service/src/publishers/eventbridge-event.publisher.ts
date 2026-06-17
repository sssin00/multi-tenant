import { Injectable } from "@nestjs/common";
import { EventBridgeClient, PutEventsCommand, type PutEventsCommandOutput } from "@aws-sdk/client-eventbridge";

import type { PublisherConfig } from "../config/app.config.js";
import type { DomainEventEnvelope } from "../relay/domain-event-envelope.js";
import { EventPublishError, type EventPublisher, type EventPublishResult } from "./event-publisher.js";

@Injectable()
export class EventBridgeEventPublisher implements EventPublisher {
  private readonly busName: string;
  private readonly sourcePrefix: string;

  constructor(
    config: PublisherConfig,
    private readonly client = new EventBridgeClient({})
  ) {
    if (!config.eventBridgeBusName) {
      throw new Error("OUTBOX_EVENTBRIDGE_BUS_NAME is required when EventBridge publisher is enabled");
    }

    this.busName = config.eventBridgeBusName;
    this.sourcePrefix = config.eventSourcePrefix;
  }

  async publish(event: DomainEventEnvelope): Promise<EventPublishResult> {
    const response = await this.sendEvent(event);

    this.assertPublished(event, response);
    return { publishedTarget: this.busName };
  }

  private async sendEvent(event: DomainEventEnvelope): Promise<PutEventsCommandOutput> {
    try {
      return await this.client.send(
        new PutEventsCommand({
          Entries: [
            {
              EventBusName: this.busName,
              Source: buildEventBridgeSource(this.sourcePrefix, event.source),
              DetailType: event.eventType,
              Detail: JSON.stringify(event),
              Time: new Date(event.occurredAt)
            }
          ]
        })
      );
    } catch (error) {
      throw new EventPublishError(`Failed to publish event ${event.eventId} to EventBridge`, event.eventId, error);
    }
  }

  private assertPublished(event: DomainEventEnvelope, response: PutEventsCommandOutput): void {
    if (!response.FailedEntryCount) {
      return;
    }

    const failedEntry = response.Entries?.find((entry: { ErrorCode?: string; ErrorMessage?: string }) => entry.ErrorCode || entry.ErrorMessage);
    const reason = [failedEntry?.ErrorCode, failedEntry?.ErrorMessage].filter(Boolean).join(": ");
    throw new EventPublishError(`Failed to publish event ${event.eventId} to EventBridge${reason ? `: ${reason}` : ""}`, event.eventId);
  }
}

function buildEventBridgeSource(prefix: string, eventSource: string): string {
  const normalizedPrefix = prefix.trim().replace(/\.+$/u, "");
  const normalizedSource = eventSource.trim().replace(/^\.+/u, "");

  return normalizedPrefix ? `${normalizedPrefix}.${normalizedSource}` : normalizedSource;
}

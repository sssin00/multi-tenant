import { Injectable } from "@nestjs/common";
import {
  SendMessageCommand,
  SQSClient,
  type MessageAttributeValue,
  type SendMessageCommandInput,
  type SendMessageCommandOutput
} from "@aws-sdk/client-sqs";

import type { PublisherConfig } from "../config/app.config.js";
import type { DomainEventEnvelope } from "../relay/domain-event-envelope.js";
import { EventPublishError, type EventPublisher, type EventPublishResult } from "./event-publisher.js";

@Injectable()
export class SqsEventPublisher implements EventPublisher {
  private readonly queueUrl: string;
  private readonly messageGroupStrategy: PublisherConfig["sqsMessageGroupStrategy"];

  constructor(
    config: PublisherConfig,
    private readonly client = new SQSClient({
      endpoint: config.sqsEndpoint
    })
  ) {
    if (!config.sqsQueueUrl) {
      throw new Error("OUTBOX_SQS_QUEUE_URL is required when SQS publisher is enabled");
    }

    this.queueUrl = config.sqsQueueUrl;
    this.messageGroupStrategy = config.sqsMessageGroupStrategy;
  }

  async publish(event: DomainEventEnvelope): Promise<EventPublishResult> {
    const response = await this.sendMessage(event);

    this.assertPublished(event, response);
    return {
      publishedTarget: this.queueUrl,
      providerMessageId: response.MessageId
    };
  }

  private async sendMessage(event: DomainEventEnvelope): Promise<SendMessageCommandOutput> {
    try {
      return await this.client.send(
        new SendMessageCommand({
          QueueUrl: this.queueUrl,
          MessageBody: JSON.stringify(event),
          MessageAttributes: buildMessageAttributes(event),
          ...this.buildFifoOptions(event)
        })
      );
    } catch (error) {
      throw new EventPublishError(`Failed to publish event ${event.eventId} to SQS`, event.eventId, error);
    }
  }

  private buildFifoOptions(event: DomainEventEnvelope): Partial<Pick<SendMessageCommandInput, "MessageDeduplicationId" | "MessageGroupId">> {
    if (!this.queueUrl.toLowerCase().endsWith(".fifo")) {
      return {};
    }

    return {
      MessageDeduplicationId: event.eventId,
      MessageGroupId: selectMessageGroupId(event, this.messageGroupStrategy)
    };
  }

  private assertPublished(event: DomainEventEnvelope, response: SendMessageCommandOutput): void {
    if (response.MessageId) {
      return;
    }

    throw new EventPublishError(`Failed to publish event ${event.eventId} to SQS: missing MessageId`, event.eventId);
  }
}

function buildMessageAttributes(event: DomainEventEnvelope): Record<string, MessageAttributeValue> {
  return {
    eventId: toStringAttribute(event.eventId),
    eventType: toStringAttribute(event.eventType),
    schemaVersion: toStringAttribute(String(event.schemaVersion)),
    tenantId: toStringAttribute(event.tenantId),
    requestId: toStringAttribute(event.requestId),
    source: toStringAttribute(event.source)
  };
}

function selectMessageGroupId(event: DomainEventEnvelope, strategy: PublisherConfig["sqsMessageGroupStrategy"]): string {
  switch (strategy) {
    case "tenantId":
      return event.tenantId;
    case "eventType":
      return event.eventType;
    case "aggregateId":
      return event.aggregateId;
  }
}

function toStringAttribute(value: string): MessageAttributeValue {
  return {
    DataType: "String",
    StringValue: value
  };
}

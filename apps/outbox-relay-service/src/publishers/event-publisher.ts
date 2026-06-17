import type { DomainEventEnvelope } from "../relay/domain-event-envelope.js";

export interface EventPublishResult {
  publishedTarget: string;
  providerMessageId?: string;
}

export interface EventPublisher {
  publish(event: DomainEventEnvelope): Promise<EventPublishResult>;
}

export class EventPublishError extends Error {
  readonly eventId: string;
  override readonly cause?: unknown;

  constructor(message: string, eventId: string, cause?: unknown) {
    super(message);
    this.name = "EventPublishError";
    this.eventId = eventId;
    this.cause = cause;
  }
}

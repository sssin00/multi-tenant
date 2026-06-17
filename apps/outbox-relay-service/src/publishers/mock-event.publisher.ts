import { Injectable } from "@nestjs/common";

import type { DomainEventEnvelope } from "../relay/domain-event-envelope.js";
import type { EventPublisher, EventPublishResult } from "./event-publisher.js";

@Injectable()
export class MockEventPublisher implements EventPublisher {
  private readonly publishedEvents: DomainEventEnvelope[] = [];

  async publish(event: DomainEventEnvelope): Promise<EventPublishResult> {
    this.publishedEvents.push(event);
    return { publishedTarget: "mock" };
  }

  getPublishedEvents(): readonly DomainEventEnvelope[] {
    return this.publishedEvents;
  }
}

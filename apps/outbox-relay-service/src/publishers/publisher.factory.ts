import type { PublisherConfig } from "../config/app.config.js";
import { EventBridgeEventPublisher } from "./eventbridge-event.publisher.js";
import type { EventPublisher } from "./event-publisher.js";
import { MockEventPublisher } from "./mock-event.publisher.js";
import { SqsEventPublisher } from "./sqs-event.publisher.js";

export function createEventPublisher(config: PublisherConfig): EventPublisher {
  switch (config.type) {
    case "eventbridge":
      return new EventBridgeEventPublisher(config);
    case "sqs":
      return new SqsEventPublisher(config);
    case "mock":
      return new MockEventPublisher();
  }
}

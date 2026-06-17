import type { ClaimedOutboxEvent } from "../sources/outbox-source.interface.js";
import type { DomainEventEnvelope } from "./domain-event-envelope.js";

export function validateClaimedEventEnvelope(event: ClaimedOutboxEvent): DomainEventEnvelope {
  const payload = event.payload;
  if (!isRecord(payload)) {
    throw new Error("Outbox payload must be an object");
  }

  assertEqual(payload.eventId, event.eventId, "eventId");
  assertEqual(payload.eventType, event.eventType, "eventType");
  assertEqual(payload.schemaVersion, event.schemaVersion, "schemaVersion");
  assertEqual(payload.tenantId, event.tenantId, "tenantId");
  assertEqual(payload.requestId, event.requestId, "requestId");
  assertEqual(payload.source, event.source, "source");
  assertEqual(payload.aggregateType, event.aggregateType, "aggregateType");
  assertEqual(payload.aggregateId, event.aggregateId, "aggregateId");

  if (typeof payload.occurredAt !== "string" || Number.isNaN(Date.parse(payload.occurredAt))) {
    throw new Error("payload.occurredAt must be an ISO 8601 string");
  }

  if (!("data" in payload)) {
    throw new Error("payload.data is required");
  }

  return payload as DomainEventEnvelope;
}

function assertEqual(actual: unknown, expected: unknown, field: string) {
  if (actual !== expected) {
    throw new Error(`payload.${field} does not match outbox ${field}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

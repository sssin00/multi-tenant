export const eventsPackageName = "@multi-tenant/events";

export type EventActorType = "user" | "system" | "service";

export interface EventActor {
  type: EventActorType;
  id?: string | null;
  userId?: string | null;
  serviceId?: string | null;
}

export type EventJsonValue =
  | string
  | number
  | boolean
  | null
  | EventJsonValue[]
  | {
      [key: string]: EventJsonValue;
    };

export interface DomainEventEnvelope<TData extends EventJsonValue = EventJsonValue> {
  eventId: string;
  eventType: string;
  schemaVersion: number;
  tenantId: string;
  requestId: string;
  occurredAt: string;
  source: string;
  aggregateType: string;
  aggregateId: string;
  actor?: EventActor;
  correlationId?: string;
  causationId?: string;
  traceId?: string;
  data: TData;
}

export type AuditLogEvent = DomainEventEnvelope;

export interface EventBridgeEventEnvelope<TDetail extends DomainEventEnvelope = DomainEventEnvelope> {
  id?: string;
  version?: string;
  account?: string;
  region?: string;
  time?: string;
  source?: string;
  "detail-type"?: string;
  detail: TDetail;
}

export interface SqsEventRecord {
  body: string;
  messageId?: string;
}

export interface SqsEventEnvelope {
  Records: SqsEventRecord[];
}

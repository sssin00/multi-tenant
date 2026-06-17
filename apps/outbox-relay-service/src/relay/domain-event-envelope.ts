export type EventJsonValue =
  | string
  | number
  | boolean
  | null
  | EventJsonValue[]
  | {
      [key: string]: EventJsonValue;
    };

export interface EventActor {
  type: "user" | "system" | "service";
  id?: string | null;
  userId?: string | null;
  serviceId?: string | null;
}

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

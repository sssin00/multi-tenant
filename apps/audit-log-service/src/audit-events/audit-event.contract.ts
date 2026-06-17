export interface AuditEventActor {
  type?: string;
  id?: string | null;
  userId?: string | null;
  serviceId?: string | null;
}

export interface AuditEventCommand {
  eventId?: string;
  eventType?: string;
  schemaVersion?: number;
  tenantId?: string;
  requestId?: string;
  occurredAt?: string | Date;
  source?: string;
  aggregateType?: string;
  aggregateId?: string;
  actor?: AuditEventActor;
  correlationId?: string;
  causationId?: string;
  traceId?: string;
  data?: unknown;
}

export interface EventBridgeAuditEventEnvelope {
  detail?: unknown;
}

export interface SqsAuditEventRecord {
  body?: unknown;
}

export interface SqsAuditEventEnvelope {
  Records?: SqsAuditEventRecord[];
}

export interface RecordAuditLogResponse {
  auditId: string;
  recorded: true;
}

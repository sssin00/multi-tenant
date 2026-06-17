import type { OutboxSourceName } from "../config/app.config.js";
import type { DomainEventEnvelope } from "../relay/domain-event-envelope.js";

export interface ClaimedOutboxEvent {
  outboxId: string;
  eventId: string;
  eventType: string;
  schemaVersion: number;
  tenantId: string;
  requestId: string;
  source: string;
  aggregateType: string;
  aggregateId: string;
  payload: DomainEventEnvelope;
  retryCount: number;
  createdAt: Date;
}

export interface OutboxSourceStats {
  source: OutboxSourceName;
  pendingCount: number;
  failedCount: number;
  oldestPendingAgeSeconds: number | null;
}

export interface OutboxSource {
  readonly name: OutboxSourceName;
  claimPendingEvents(params: ClaimPendingEventsParams): Promise<ClaimedOutboxEvent[]>;
  markPublished(params: MarkPublishedParams): Promise<void>;
  markPublishFailed(params: MarkPublishFailedParams): Promise<void>;
  getStats(): Promise<OutboxSourceStats>;
  ping(): Promise<void>;
  close(): Promise<void>;
}

export interface ClaimPendingEventsParams {
  batchSize: number;
  workerId: string;
  now: Date;
  lockTimeoutSeconds: number;
}

export interface MarkPublishedParams {
  outboxId: string;
  workerId: string;
  publishedAt: Date;
  publishedTarget: string;
}

export interface MarkPublishFailedParams {
  outboxId: string;
  workerId: string;
  retryCount: number;
  status: "pending" | "failed";
  lastError: string;
  nextRetryAt: Date | null;
}

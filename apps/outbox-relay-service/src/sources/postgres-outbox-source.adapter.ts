import { Pool, type PoolClient } from "pg";

import type { OutboxSourceName } from "../config/app.config.js";
import type { DomainEventEnvelope } from "../relay/domain-event-envelope.js";
import type {
  ClaimPendingEventsParams,
  ClaimedOutboxEvent,
  MarkPublishedParams,
  MarkPublishFailedParams,
  OutboxSource,
  OutboxSourceStats
} from "./outbox-source.interface.js";

interface OutboxRow {
  outbox_id: string;
  event_id: string;
  event_type: string;
  schema_version: number;
  tenant_id: string;
  request_id: string;
  source: string;
  aggregate_type: string;
  aggregate_id: string;
  payload: unknown;
  retry_count: number;
  created_at: Date;
}

export class PostgresOutboxSourceAdapter implements OutboxSource {
  private readonly pool: Pool;

  constructor(
    readonly name: OutboxSourceName,
    databaseUrl: string
  ) {
    this.pool = new Pool({
      connectionString: databaseUrl,
      max: 2,
      application_name: `outbox-relay-service-${name}`
    });
  }

  async claimPendingEvents(params: ClaimPendingEventsParams): Promise<ClaimedOutboxEvent[]> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const rows = await this.claimRows(client, params);
      await client.query("COMMIT");
      return rows.map((row) => this.toClaimedEvent(row));
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async markPublished(params: MarkPublishedParams): Promise<void> {
    await this.pool.query(
      `
        UPDATE outbox_events
        SET status = 'published',
            published_at = $2,
            published_target = $3,
            locked_at = NULL,
            locked_by = NULL,
            next_retry_at = NULL,
            last_error = NULL
        WHERE outbox_id = $1
          AND locked_by = $4
      `,
      [params.outboxId, params.publishedAt, params.publishedTarget, params.workerId]
    );
  }

  async markPublishFailed(params: MarkPublishFailedParams): Promise<void> {
    await this.pool.query(
      `
        UPDATE outbox_events
        SET status = $2,
            retry_count = $3,
            last_error = $4,
            next_retry_at = $5,
            locked_at = NULL,
            locked_by = NULL
        WHERE outbox_id = $1
          AND locked_by = $6
      `,
      [params.outboxId, params.status, params.retryCount, params.lastError, params.nextRetryAt, params.workerId]
    );
  }

  async getStats(): Promise<OutboxSourceStats> {
    const result = await this.pool.query<{
      pending_count: string;
      failed_count: string;
      oldest_pending_at: Date | null;
    }>(
      `
        SELECT
          COUNT(*) FILTER (WHERE status = 'pending') AS pending_count,
          COUNT(*) FILTER (WHERE status = 'failed') AS failed_count,
          MIN(created_at) FILTER (WHERE status = 'pending') AS oldest_pending_at
        FROM outbox_events
      `
    );
    const row = result.rows[0];
    const oldestPendingAgeSeconds = row.oldest_pending_at
      ? Math.max(0, Math.floor((Date.now() - row.oldest_pending_at.getTime()) / 1000))
      : null;

    return {
      source: this.name,
      pendingCount: Number(row.pending_count),
      failedCount: Number(row.failed_count),
      oldestPendingAgeSeconds
    };
  }

  async ping(): Promise<void> {
    await this.pool.query("SELECT 1");
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private async claimRows(client: PoolClient, params: ClaimPendingEventsParams): Promise<OutboxRow[]> {
    const lockExpiredBefore = new Date(params.now.getTime() - params.lockTimeoutSeconds * 1000);
    const result = await client.query<OutboxRow>(
      `
        WITH candidate AS (
          SELECT outbox_id
          FROM outbox_events
          WHERE status = 'pending'
            AND (next_retry_at IS NULL OR next_retry_at <= $1)
            AND (locked_at IS NULL OR locked_at <= $2)
          ORDER BY created_at ASC
          LIMIT $3
          FOR UPDATE SKIP LOCKED
        )
        UPDATE outbox_events AS outbox
        SET locked_at = $1,
            locked_by = $4
        FROM candidate
        WHERE outbox.outbox_id = candidate.outbox_id
        RETURNING
          outbox.outbox_id,
          outbox.event_id,
          outbox.event_type,
          outbox.schema_version,
          outbox.tenant_id,
          outbox.request_id,
          outbox.source,
          outbox.aggregate_type,
          outbox.aggregate_id,
          outbox.payload,
          outbox.retry_count,
          outbox.created_at
      `,
      [params.now, lockExpiredBefore, params.batchSize, params.workerId]
    );

    return result.rows;
  }

  private toClaimedEvent(row: OutboxRow): ClaimedOutboxEvent {
    return {
      outboxId: row.outbox_id,
      eventId: row.event_id,
      eventType: row.event_type,
      schemaVersion: row.schema_version,
      tenantId: row.tenant_id,
      requestId: row.request_id,
      source: row.source,
      aggregateType: row.aggregate_type,
      aggregateId: row.aggregate_id,
      payload: row.payload as DomainEventEnvelope,
      retryCount: row.retry_count,
      createdAt: row.created_at
    };
  }
}

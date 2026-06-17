import { randomUUID } from "node:crypto";

import { Inject, Injectable, OnApplicationShutdown, OnModuleInit } from "@nestjs/common";

import { getAppConfig } from "../config/app.config.js";
import { createEventPublisher } from "../publishers/index.js";
import { OutboxSourceRegistryService } from "../sources/outbox-source-registry.service.js";
import type { ClaimedOutboxEvent, OutboxSource } from "../sources/outbox-source.interface.js";
import { validateClaimedEventEnvelope } from "./event-envelope.validator.js";
import { RelayStatusService } from "./relay-status.service.js";

@Injectable()
export class RelayWorkerService implements OnModuleInit, OnApplicationShutdown {
  private readonly config = getAppConfig();
  private readonly workerId = `outbox-relay-${randomUUID()}`;
  private timer?: NodeJS.Timeout;
  private running = false;
  private shuttingDown = false;

  constructor(
    @Inject(OutboxSourceRegistryService)
    private readonly sourceRegistry: OutboxSourceRegistryService,
    @Inject(RelayStatusService)
    private readonly relayStatusService: RelayStatusService
  ) {}

  onModuleInit() {
    this.relayStatusService.setWorkerId(this.workerId);
    if (!this.config.worker.enabled) {
      this.relayStatusService.setRunning(false);
      return;
    }

    this.timer = setInterval(() => {
      void this.runOnce();
    }, this.config.worker.pollIntervalMs);
    void this.runOnce();
  }

  async onApplicationShutdown(): Promise<void> {
    this.shuttingDown = true;
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  async runOnce(): Promise<void> {
    if (this.running || this.shuttingDown) {
      return;
    }

    this.running = true;
    this.relayStatusService.setRunning(true);
    try {
      for (const source of this.sourceRegistry.getSources()) {
        await this.processSource(source);
      }
      this.relayStatusService.markSuccess();
    } catch (error) {
      this.relayStatusService.markFailure(sanitizeError(error));
      this.log("error", "Relay worker run failed", { error: sanitizeError(error) });
    } finally {
      this.running = false;
      this.relayStatusService.setRunning(false);
    }
  }

  private async processSource(source: OutboxSource): Promise<void> {
    const events = await source.claimPendingEvents({
      batchSize: this.config.worker.batchSize,
      workerId: this.workerId,
      now: new Date(),
      lockTimeoutSeconds: this.config.worker.lockTimeoutSeconds
    });

    for (const event of events) {
      await this.processEvent(source, event);
    }
  }

  private async processEvent(source: OutboxSource, event: ClaimedOutboxEvent): Promise<void> {
    const startedAt = Date.now();
    try {
      const payload = validateClaimedEventEnvelope(event);
      const publisher = createEventPublisher(this.config.publisher);
      const result = await publisher.publish(payload);
      await source.markPublished({
        outboxId: event.outboxId,
        workerId: this.workerId,
        publishedAt: new Date(),
        publishedTarget: result.publishedTarget
      });
      this.relayStatusService.markPublished(source.name);
      this.log("info", "Outbox event published", this.eventLogFields(source.name, event, startedAt, result.publishedTarget));
    } catch (error) {
      const nextRetryCount = event.retryCount + 1;
      const isFailed = nextRetryCount >= this.config.worker.maxRetryCount;
      const nextRetryAt = isFailed ? null : this.calculateNextRetryAt(nextRetryCount);
      await source.markPublishFailed({
        outboxId: event.outboxId,
        workerId: this.workerId,
        retryCount: nextRetryCount,
        status: isFailed ? "failed" : "pending",
        lastError: sanitizeError(error),
        nextRetryAt
      });
      this.relayStatusService.markFailed(source.name, isFailed);
      this.log("error", "Outbox event publish failed", {
        ...this.eventLogFields(source.name, event, startedAt),
        retryCount: nextRetryCount,
        status: isFailed ? "failed" : "pending",
        nextRetryAt: nextRetryAt?.toISOString(),
        error: sanitizeError(error)
      });
    }
  }

  private calculateNextRetryAt(retryCount: number): Date {
    const delaySeconds = Math.min(300, 2 ** Math.max(0, retryCount - 1) * 5);
    return new Date(Date.now() + delaySeconds * 1000);
  }

  private eventLogFields(source: string, event: ClaimedOutboxEvent, startedAt: number, publishedTarget?: string) {
    return {
      source,
      eventId: event.eventId,
      eventType: event.eventType,
      tenantId: event.tenantId,
      requestId: event.requestId,
      outboxId: event.outboxId,
      publishedTarget,
      durationMs: Date.now() - startedAt
    };
  }

  private log(level: "info" | "error", message: string, extra: Record<string, unknown>) {
    const payload = {
      timestamp: new Date().toISOString(),
      level,
      service: this.config.serviceName,
      env: this.config.env,
      message,
      workerId: this.workerId,
      ...extra
    };

    if (level === "error") {
      console.error(JSON.stringify(payload));
      return;
    }

    console.log(JSON.stringify(payload));
  }
}

function sanitizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Unknown error";
  return message.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "postgresql://[redacted]").slice(0, 1000);
}

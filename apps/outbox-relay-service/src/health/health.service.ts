import { Inject, Injectable } from "@nestjs/common";

import { getAppConfig, type AppConfig, type PublisherConfig, type SourceConfig, type WorkerConfig } from "../config/app.config.js";
import { RelayStatusService } from "../relay/relay-status.service.js";

export interface ReadinessResponse {
  status: "ready" | "not_ready";
  service: string;
  timestamp: string;
  checks: {
    config: ReadinessCheck;
    sources: ReadinessCheck;
    publisher: ReadinessCheck;
    worker: ReadinessCheck;
    security: ReadinessCheck;
  };
}

interface ReadinessCheck {
  status: "ok" | "failed";
  message?: string;
}

@Injectable()
export class HealthService {
  private readonly config = getAppConfig();

  constructor(
    @Inject(RelayStatusService)
    private readonly relayStatusService: RelayStatusService
  ) {}

  getReadiness(): ReadinessResponse {
    const checks = {
      config: this.checkConfig(this.config),
      sources: this.checkSources(this.config.sources, this.config.worker),
      publisher: this.checkPublisher(this.config.publisher),
      worker: this.checkWorker(this.config.worker),
      security: this.checkSecurity(this.config)
    };
    const isReady = Object.values(checks).every((check) => check.status === "ok");

    return {
      status: isReady ? "ready" : "not_ready",
      service: this.config.serviceName,
      timestamp: new Date().toISOString(),
      checks
    };
  }

  private checkConfig(config: AppConfig): ReadinessCheck {
    if (!config.port || config.port <= 0) {
      return { status: "failed", message: "OUTBOX_PORT must be a positive number" };
    }

    if (!config.requestIdHeader || !config.tenantHeader) {
      return { status: "failed", message: "Request context headers must be configured" };
    }

    return { status: "ok" };
  }

  private checkSources(sources: SourceConfig[], worker: WorkerConfig): ReadinessCheck {
    if (!worker.enabled) {
      return { status: "ok" };
    }

    if (sources.length === 0) {
      return { status: "failed", message: "OUTBOX_SOURCES must include at least one source when worker is enabled" };
    }

    const missingSources = sources.filter((source) => !source.databaseUrl).map((source) => source.name);
    if (missingSources.length > 0) {
      return {
        status: "failed",
        message: `Missing outbox database URL for sources: ${missingSources.join(", ")}`
      };
    }

    return { status: "ok" };
  }

  private checkPublisher(publisher: PublisherConfig): ReadinessCheck {
    if (publisher.type === "eventbridge" && !publisher.eventBridgeBusName) {
      return { status: "failed", message: "OUTBOX_EVENTBRIDGE_BUS_NAME is required when EventBridge publisher is enabled" };
    }

    if (publisher.type === "sqs" && !publisher.sqsQueueUrl) {
      return { status: "failed", message: "OUTBOX_SQS_QUEUE_URL is required when SQS publisher is enabled" };
    }

    return { status: "ok" };
  }

  private checkWorker(worker: WorkerConfig): ReadinessCheck {
    if (!worker.enabled) {
      return { status: "ok", message: "Worker is disabled" };
    }

    if (worker.pollIntervalMs <= 0) {
      return { status: "failed", message: "OUTBOX_POLL_INTERVAL_MS must be positive" };
    }

    if (worker.batchSize <= 0) {
      return { status: "failed", message: "OUTBOX_BATCH_SIZE must be positive" };
    }

    if (worker.maxRetryCount < 0) {
      return { status: "failed", message: "OUTBOX_MAX_RETRY_COUNT must be zero or greater" };
    }

    if (worker.lockTimeoutSeconds <= 0) {
      return { status: "failed", message: "OUTBOX_LOCK_TIMEOUT_SECONDS must be positive" };
    }

    if (!this.relayStatusService.isRunnable()) {
      return { status: "failed", message: "Relay worker is not initialized" };
    }

    return { status: "ok" };
  }

  private checkSecurity(config: AppConfig): ReadinessCheck {
    if (config.env === "prod" && config.cors.allowedOrigins.length === 0) {
      return { status: "failed", message: "OUTBOX_CORS_ALLOWED_ORIGINS is required in prod" };
    }

    if (config.cors.allowedOrigins.some((origin) => origin === "*")) {
      return { status: "failed", message: "Wildcard CORS origin is not allowed" };
    }

    return { status: "ok" };
  }
}

import { Injectable } from "@nestjs/common";

import { getAppConfig } from "../config/app.config.js";

export interface RelayRuntimeStatus {
  workerEnabled: boolean;
  publisherType: string;
  sources: string[];
  workerId?: string;
  running: boolean;
  publishedCount: number;
  retryCount: number;
  failedCount: number;
  lastSuccessAt?: string;
  lastFailureAt?: string;
  lastError?: string;
}

@Injectable()
export class RelayStatusService {
  private readonly config = getAppConfig();
  private workerId?: string;
  private running = false;
  private publishedCount = 0;
  private retryCount = 0;
  private failedCount = 0;
  private lastSuccessAt?: string;
  private lastFailureAt?: string;
  private lastError?: string;

  isRunnable(): boolean {
    return true;
  }

  setWorkerId(workerId: string): void {
    this.workerId = workerId;
  }

  setRunning(running: boolean): void {
    this.running = running;
  }

  markSuccess(): void {
    this.lastSuccessAt = new Date().toISOString();
  }

  markFailure(error: string): void {
    this.lastFailureAt = new Date().toISOString();
    this.lastError = error;
  }

  markPublished(_source: string): void {
    this.publishedCount += 1;
  }

  markFailed(_source: string, terminal: boolean): void {
    if (terminal) {
      this.failedCount += 1;
      return;
    }

    this.retryCount += 1;
  }

  getStatus(): RelayRuntimeStatus {
    return {
      workerEnabled: this.config.worker.enabled,
      publisherType: this.config.publisher.type,
      sources: this.config.sources.map((source) => source.name),
      workerId: this.workerId,
      running: this.running,
      publishedCount: this.publishedCount,
      retryCount: this.retryCount,
      failedCount: this.failedCount,
      lastSuccessAt: this.lastSuccessAt,
      lastFailureAt: this.lastFailureAt,
      lastError: this.lastError
    };
  }
}

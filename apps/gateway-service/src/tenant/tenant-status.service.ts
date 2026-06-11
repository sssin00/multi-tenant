import { createHash, createHmac } from "node:crypto";

import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { createClient, type RedisClientType } from "redis";

import { getAppConfig } from "../config/app.config.js";
import { getRequestContext } from "../context/request-context.js";

export type TenantStatus = "provisioning" | "active" | "suspended" | "deleted";

export interface TenantStatusResult {
  tenantId: string;
  status: TenantStatus;
  source: "cache" | "upstream";
}

interface TenantStatusResponse {
  tenantId?: string;
  status?: string;
}

interface TenantStatusEnvelope {
  success?: boolean;
  data?: TenantStatusResponse;
}

@Injectable()
export class TenantStatusService implements OnModuleDestroy {
  private readonly config = getAppConfig();
  private readonly client?: RedisClientType;
  private connectPromise?: Promise<RedisClientType>;

  constructor() {
    if (this.config.redis.url) {
      this.client = createClient({
        url: this.config.redis.url
      }) as RedisClientType;

      this.client.on("error", (error) => {
        console.error(
          JSON.stringify({
            timestamp: new Date().toISOString(),
            level: "error",
            service: this.config.serviceName,
            env: this.config.env,
            errorCode: "REDIS_ERROR",
            message: error instanceof Error ? error.message : "Redis client error"
          })
        );
      });
    }
  }

  async getStatus(tenantId: string): Promise<TenantStatusResult> {
    const cachedStatus = await this.getCachedStatus(tenantId);
    if (cachedStatus) {
      return {
        tenantId,
        status: cachedStatus,
        source: "cache"
      };
    }

    const upstreamStatus = await this.fetchStatus(tenantId);
    await this.setCachedStatus(tenantId, upstreamStatus);

    return {
      tenantId,
      status: upstreamStatus,
      source: "upstream"
    };
  }

  async onModuleDestroy() {
    if (this.client?.isOpen) {
      await this.client.quit();
    }
  }

  private async getCachedStatus(tenantId: string): Promise<TenantStatus | undefined> {
    const client = await this.getClientOrUndefined();
    if (!client) {
      return undefined;
    }

    const value = await client.get(this.cacheKey(tenantId));
    return this.parseStatus(value);
  }

  private async setCachedStatus(tenantId: string, status: TenantStatus) {
    const client = await this.getClientOrUndefined();
    if (!client) {
      return;
    }

    await client.set(this.cacheKey(tenantId), status, {
      EX: this.config.tenantStatus.cacheTtlSeconds
    });
  }

  private async fetchStatus(tenantId: string): Promise<TenantStatus> {
    const serviceUrl = this.config.tenantStatus.serviceUrl;
    if (!serviceUrl) {
      throw new Error("TENANT_SERVICE_URL is not configured");
    }

    if (!this.config.tenantStatus.internalAuthSecret) {
      throw new Error("TENANT_INTERNAL_AUTH_SECRET is not configured");
    }

    const target = new URL(`/internal/tenants/${encodeURIComponent(tenantId)}/status`, serviceUrl);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.tenantStatus.timeoutMs);
    const timestamp = new Date().toISOString();
    const requestId = getRequestContext()?.requestId ?? "";

    try {
      const response = await fetch(target, {
        method: "GET",
        headers: {
          accept: "application/json",
          "x-request-id": requestId,
          "x-internal-service-id": this.config.serviceName,
          "x-internal-timestamp": timestamp,
          "x-internal-signature": this.sign("GET", target, timestamp, requestId)
        },
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`Tenant status upstream returned ${response.status}`);
      }

      const body = (await response.json()) as TenantStatusEnvelope | TenantStatusResponse;
      const status = this.parseStatus(this.readStatus(body));
      if (!status) {
        throw new Error("Tenant status upstream returned invalid status");
      }

      return status;
    } finally {
      clearTimeout(timeout);
    }
  }

  private parseStatus(value: string | null | undefined): TenantStatus | undefined {
    if (value === "provisioning" || value === "active" || value === "suspended" || value === "deleted") {
      return value;
    }

    return undefined;
  }

  private readStatus(body: TenantStatusEnvelope | TenantStatusResponse): string | undefined {
    if ("data" in body && body.data) {
      return body.data.status;
    }

    if ("status" in body) {
      return body.status;
    }

    return undefined;
  }

  private sign(method: string, target: URL, timestamp: string, requestId: string): string {
    const bodyHash = createHash("sha256").update("").digest("hex");
    const payload = [method.toUpperCase(), `${target.pathname}${target.search}`, timestamp, requestId, bodyHash].join("\n");

    return createHmac("sha256", this.config.tenantStatus.internalAuthSecret ?? "").update(payload).digest("hex");
  }

  private cacheKey(tenantId: string): string {
    return ["tenant-status", this.config.env, tenantId].join(":");
  }

  private async getClientOrUndefined(): Promise<RedisClientType | undefined> {
    if (!this.client) {
      return undefined;
    }

    if (this.client.isOpen) {
      return this.client;
    }

    this.connectPromise ??= this.client.connect().then(() => this.client as RedisClientType);
    return this.connectPromise;
  }
}

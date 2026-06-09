import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { createClient, type RedisClientType } from "redis";

import { getAppConfig } from "../config/app.config.js";

export interface RateLimitConsumeResult {
  count: number;
  limit: number;
  remaining: number;
  resetAt: number;
  exceeded: boolean;
}

@Injectable()
export class RedisRateLimitService implements OnModuleDestroy {
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

  async consume(key: string, limit: number, windowSeconds: number): Promise<RateLimitConsumeResult> {
    const client = await this.getClient();
    const count = await client.incr(key);

    if (count === 1) {
      await client.expire(key, windowSeconds);
    }

    const ttl = await client.ttl(key);
    const resetAt = Math.floor(Date.now() / 1000) + Math.max(ttl, 0);
    const remaining = Math.max(limit - count, 0);

    return {
      count,
      limit,
      remaining,
      resetAt,
      exceeded: count > limit
    };
  }

  async onModuleDestroy() {
    if (this.client?.isOpen) {
      await this.client.quit();
    }
  }

  private async getClient(): Promise<RedisClientType> {
    if (!this.client) {
      throw new Error("REDIS_URL is not configured");
    }

    if (this.client.isOpen) {
      return this.client;
    }

    this.connectPromise ??= this.client.connect().then(() => this.client as RedisClientType);
    return this.connectPromise;
  }
}

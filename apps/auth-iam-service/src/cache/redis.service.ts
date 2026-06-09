import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { createClient, type RedisClientType } from "redis";

import { getAppConfig } from "../config/app.config.js";

@Injectable()
export class RedisService implements OnModuleDestroy {
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

  async ping(): Promise<boolean> {
    const client = await this.getClient();
    const response = await client.ping();
    return response === "PONG";
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

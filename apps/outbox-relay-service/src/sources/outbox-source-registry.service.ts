import { Injectable, OnApplicationShutdown } from "@nestjs/common";

import { getAppConfig } from "../config/app.config.js";
import type { OutboxSource, OutboxSourceStats } from "./outbox-source.interface.js";
import { PostgresOutboxSourceAdapter } from "./postgres-outbox-source.adapter.js";

@Injectable()
export class OutboxSourceRegistryService implements OnApplicationShutdown {
  private readonly config = getAppConfig();
  private readonly sources = this.config.sources
    .filter((source) => source.databaseUrl)
    .map((source) => new PostgresOutboxSourceAdapter(source.name, source.databaseUrl as string));

  getSources(): OutboxSource[] {
    return this.sources;
  }

  async getStats(): Promise<OutboxSourceStats[]> {
    return Promise.all(this.sources.map((source) => source.getStats()));
  }

  async pingAll(): Promise<void> {
    await Promise.all(this.sources.map((source) => source.ping()));
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.all(this.sources.map((source) => source.close()));
  }
}

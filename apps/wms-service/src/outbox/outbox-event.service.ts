import { randomUUID } from "node:crypto";

import { Injectable } from "@nestjs/common";

import type { Prisma } from "../generated/prisma/client.js";

export interface OutboxContext {
  tenantId: string;
  userId?: string;
  requestId?: string;
}

export interface OutboxEventCommand {
  context: OutboxContext;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  data: Prisma.InputJsonObject;
  schemaVersion?: number;
}

@Injectable()
export class OutboxEventService {
  async record(tx: Prisma.TransactionClient, command: OutboxEventCommand): Promise<void> {
    const eventId = randomUUID();
    const occurredAt = new Date().toISOString();

    await tx.outboxEvent.create({
      data: {
        eventId,
        eventType: command.eventType,
        schemaVersion: command.schemaVersion ?? 1,
        tenantId: command.context.tenantId,
        requestId: command.context.requestId ?? "unknown",
        source: "wms-service",
        aggregateType: command.aggregateType,
        aggregateId: command.aggregateId,
        payload: {
          eventId,
          eventType: command.eventType,
          schemaVersion: command.schemaVersion ?? 1,
          tenantId: command.context.tenantId,
          requestId: command.context.requestId ?? "unknown",
          occurredAt,
          source: "wms-service",
          aggregateType: command.aggregateType,
          aggregateId: command.aggregateId,
          actor: {
            type: command.context.userId ? "user" : "system",
            userId: command.context.userId ?? null
          },
          data: command.data
        }
      }
    });
  }
}

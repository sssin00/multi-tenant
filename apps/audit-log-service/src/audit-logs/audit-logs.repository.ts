import { Inject, Injectable } from "@nestjs/common";

import { PrismaService } from "../database/prisma.service.js";
import { type AuditActorType, type AuditResult } from "../generated/prisma/enums.js";
import type { Prisma } from "../generated/prisma/client.js";
import type { AuditLogModel } from "../generated/prisma/models/AuditLog.js";

export interface AppendAuditLogData {
  eventId?: string;
  tenantId: string;
  requestId: string;
  occurredAt: Date;
  actorType: AuditActorType;
  actorId?: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  result: AuditResult;
  reason?: string;
  details?: Prisma.InputJsonValue;
}

export interface AuditLogSearchFilters {
  tenantId?: string;
  page: number;
  size: number;
  from?: Date;
  to?: Date;
  actorType?: AuditActorType;
  actorId?: string;
  action?: string;
  resourceType?: string;
  resourceId?: string;
  result?: AuditResult;
  requestId?: string;
}

export interface AuditLogSearchResult {
  items: AuditLogModel[];
  total: number;
}

@Injectable()
export class AuditLogsRepository {
  constructor(
    @Inject(PrismaService)
    private readonly prismaService: PrismaService
  ) {}

  async append(data: AppendAuditLogData): Promise<AuditLogModel> {
    return this.prismaService.auditLog.create({
      data: {
        eventId: data.eventId,
        tenantId: data.tenantId,
        requestId: data.requestId,
        occurredAt: data.occurredAt,
        actorType: data.actorType,
        actorId: data.actorId,
        action: data.action,
        resourceType: data.resourceType,
        resourceId: data.resourceId,
        result: data.result,
        reason: data.reason,
        details: data.details
      }
    });
  }

  async findByEventId(eventId: string): Promise<AuditLogModel | null> {
    return this.prismaService.auditLog.findUnique({
      where: {
        eventId
      }
    });
  }

  async search(filters: AuditLogSearchFilters): Promise<AuditLogSearchResult> {
    const where = this.toWhere(filters);
    const [items, total] = await Promise.all([
      this.prismaService.auditLog.findMany({
        where,
        orderBy: [
          {
            occurredAt: "desc"
          },
          {
            createdAt: "desc"
          }
        ],
        skip: (filters.page - 1) * filters.size,
        take: filters.size
      }),
      this.prismaService.auditLog.count({
        where
      })
    ]);

    return {
      items,
      total
    };
  }

  private toWhere(filters: AuditLogSearchFilters): Prisma.AuditLogWhereInput {
    return {
      ...(filters.tenantId ? { tenantId: filters.tenantId } : {}),
      ...(filters.from || filters.to
        ? {
            occurredAt: {
              ...(filters.from ? { gte: filters.from } : {}),
              ...(filters.to ? { lte: filters.to } : {})
            }
          }
        : {}),
      ...(filters.actorType ? { actorType: filters.actorType } : {}),
      ...(filters.actorId ? { actorId: filters.actorId } : {}),
      ...(filters.action ? { action: filters.action } : {}),
      ...(filters.resourceType ? { resourceType: filters.resourceType } : {}),
      ...(filters.resourceId ? { resourceId: filters.resourceId } : {}),
      ...(filters.result ? { result: filters.result } : {}),
      ...(filters.requestId ? { requestId: filters.requestId } : {})
    };
  }
}

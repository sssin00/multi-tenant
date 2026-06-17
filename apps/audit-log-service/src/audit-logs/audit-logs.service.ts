import { BadRequestException, Inject, Injectable, ServiceUnavailableException } from "@nestjs/common";

import { AuditLogsRepository, type AuditLogSearchFilters } from "./audit-logs.repository.js";
import type { AuditEventActor, AuditEventCommand, RecordAuditLogResponse } from "../audit-events/audit-event.contract.js";
import { AuditActorType, AuditResult } from "../generated/prisma/enums.js";
import type { Prisma } from "../generated/prisma/client.js";
import type { AuditLogModel } from "../generated/prisma/models/AuditLog.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFAULT_PAGE = 1;
const DEFAULT_SIZE = 20;
const MAX_SIZE = 100;
const AUDIT_LOG_WRITE_FAILED = "AUDIT_LOG_WRITE_FAILED";
const AUDIT_LOG_QUERY_FAILED = "AUDIT_LOG_QUERY_FAILED";
const SENSITIVE_DETAIL_KEYS = [
  "authorization",
  "cookie",
  "password",
  "accesstoken",
  "refreshtoken",
  "token",
  "secret",
  "apikey",
  "api_key",
  "privatekey",
  "private_key",
  "sql",
  "stack",
  "stacktrace",
  "stack_trace"
];

export interface ListAuditLogsCommand {
  tenantId?: string;
  page?: unknown;
  size?: unknown;
  from?: unknown;
  to?: unknown;
  actorType?: unknown;
  actorId?: unknown;
  action?: unknown;
  resourceType?: unknown;
  resourceId?: unknown;
  result?: unknown;
  requestId?: unknown;
}

export interface AuditLogResponse {
  auditId: string;
  eventId?: string | null;
  occurredAt: string;
  tenantId: string;
  actor: {
    type: AuditActorType;
    userId?: string | null;
    serviceId?: string | null;
  };
  action: string;
  resource: {
    type: string;
    id: string | null;
  };
  result: AuditResult;
  requestId: string;
  reason?: string | null;
  details?: Prisma.JsonValue;
  createdAt: string;
}

export interface AuditLogListResponse {
  items: AuditLogResponse[];
  page: number;
  size: number;
  total: number;
}

@Injectable()
export class AuditLogsService {
  constructor(
    @Inject(AuditLogsRepository)
    private readonly auditLogsRepository: AuditLogsRepository
  ) {}

  async recordFromEvent(command: AuditEventCommand): Promise<RecordAuditLogResponse> {
    const eventId = this.requireUuid(command.eventId, "eventId");
    const existing = await this.auditLogsRepository.findByEventId(eventId);
    if (existing) {
      return {
        auditId: existing.auditId,
        recorded: true
      };
    }

    this.requireSchemaVersion(command.schemaVersion);
    const tenantId = this.requireUuid(command.tenantId, "tenantId");
    const requestId = this.requireString(command.requestId, "requestId");
    const occurredAt = this.readOccurredAt(command.occurredAt);
    const action = this.requireString(command.eventType, "eventType");
    const resourceType = this.requireString(command.aggregateType, "aggregateType");
    const resourceId = this.requireString(command.aggregateId, "aggregateId");
    const source = this.requireString(command.source, "source");
    const actor = this.readEventActor(command.actor, source);
    const details = this.readDetails(command.data ?? {});

    const auditLog = await this.appendAuditLog({
      eventId,
      tenantId,
      requestId,
      occurredAt,
      actorType: actor.type,
      actorId: actor.id,
      action,
      resourceType,
      resourceId,
      result: AuditResult.success,
      details
    });

    return {
      auditId: auditLog.auditId,
      recorded: true
    };
  }

  async list(command: ListAuditLogsCommand): Promise<AuditLogListResponse> {
    const page = this.readPage(command.page);
    const size = this.readSize(command.size);
    const from = this.readOptionalDate(command.from, "from");
    const to = this.readOptionalDate(command.to, "to");
    if (from && to && from.getTime() > to.getTime()) {
      throw this.validationError("from", "from must be earlier than or equal to to");
    }

    const filters: AuditLogSearchFilters = {
      tenantId: this.requireUuid(command.tenantId, "tenantId"),
      page,
      size,
      from,
      to,
      actorType: this.readOptionalActorType(command.actorType),
      actorId: this.readOptionalString(command.actorId, "actorId"),
      action: this.readOptionalString(command.action, "action"),
      resourceType: this.readOptionalString(command.resourceType, "resourceType"),
      resourceId: this.readOptionalString(command.resourceId, "resourceId"),
      result: this.readOptionalResult(command.result),
      requestId: this.readOptionalString(command.requestId, "requestId")
    };

    const result = await this.searchAuditLogs(filters);
    return {
      items: result.items.map((item) => this.toResponse(item)),
      page,
      size,
      total: result.total
    };
  }

  private async appendAuditLog(data: Parameters<AuditLogsRepository["append"]>[0]): Promise<AuditLogModel> {
    try {
      return await this.auditLogsRepository.append(data);
    } catch {
      throw new ServiceUnavailableException({
        code: AUDIT_LOG_WRITE_FAILED,
        message: "Audit log write failed",
        details: {
          operation: "append_audit_log"
        }
      });
    }
  }

  private async searchAuditLogs(filters: AuditLogSearchFilters): Promise<{
    items: AuditLogModel[];
    total: number;
  }> {
    try {
      return await this.auditLogsRepository.search(filters);
    } catch {
      throw new ServiceUnavailableException({
        code: AUDIT_LOG_QUERY_FAILED,
        message: "Audit log query failed",
        details: {
          operation: "search_audit_logs"
        }
      });
    }
  }

  private readEventActor(value: AuditEventActor | undefined, source: string): { type: AuditActorType; id?: string } {
    if (!value || typeof value !== "object") {
      return {
        type: AuditActorType.service,
        id: source
      };
    }

    const rawType = value.type ?? (value.userId ? AuditActorType.user : AuditActorType.service);
    const type = this.readActorType(rawType);
    const id = this.readActorId(type, {
      ...value,
      serviceId: value.serviceId ?? (type === AuditActorType.service ? source : undefined)
    });

    return {
      type,
      id
    };
  }

  private readActorId(type: AuditActorType, actor: AuditEventActor): string | undefined {
    if (type === AuditActorType.user) {
      return this.readNullableString(actor.userId ?? actor.id, "actor.userId");
    }

    if (type === AuditActorType.service) {
      return this.readNullableString(actor.serviceId ?? actor.id, "actor.serviceId");
    }

    return this.readNullableString(actor.id, "actor.id");
  }

  private readDetails(value: unknown): Prisma.InputJsonValue | undefined {
    if (value === undefined || value === null) {
      return undefined;
    }

    if (!this.isJsonValue(value)) {
      throw this.validationError("details", "details must be JSON serializable");
    }

    const sensitivePath = this.findSensitiveDetailPath(value);
    if (sensitivePath) {
      throw this.validationError("details", `details must not include sensitive field ${sensitivePath}`);
    }

    return value as Prisma.InputJsonValue;
  }

  private readOccurredAt(value: string | Date | undefined): Date {
    if (value === undefined) {
      return new Date();
    }

    if (value instanceof Date) {
      if (Number.isNaN(value.getTime())) {
        throw this.validationError("occurredAt", "occurredAt must be a valid ISO 8601 date");
      }

      return value;
    }

    if (typeof value !== "string" || value.trim().length === 0) {
      throw this.validationError("occurredAt", "occurredAt must be a valid ISO 8601 date");
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw this.validationError("occurredAt", "occurredAt must be a valid ISO 8601 date");
    }

    return parsed;
  }

  private readOptionalDate(value: unknown, field: string): Date | undefined {
    if (value === undefined || value === null || value === "") {
      return undefined;
    }

    if (typeof value !== "string") {
      throw this.validationError(field, `${field} must be a valid ISO 8601 date`);
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw this.validationError(field, `${field} must be a valid ISO 8601 date`);
    }

    return parsed;
  }

  private readActorType(value: unknown): AuditActorType {
    if (value === AuditActorType.user || value === AuditActorType.system || value === AuditActorType.service) {
      return value;
    }

    throw this.validationError("actor.type", "actor.type must be user, system, or service");
  }

  private readOptionalActorType(value: unknown): AuditActorType | undefined {
    if (value === undefined || value === null || value === "") {
      return undefined;
    }

    return this.readActorType(value);
  }

  private readOptionalResult(value: unknown): AuditResult | undefined {
    if (value === undefined || value === null || value === "") {
      return undefined;
    }

    return this.requireResult(value);
  }

  private requireResult(value: unknown): AuditResult {
    if (value === AuditResult.success || value === AuditResult.failure) {
      return value;
    }

    throw this.validationError("result", "result must be success or failure");
  }

  private requireSchemaVersion(value: unknown): number {
    if (!Number.isInteger(value) || (value as number) < 1) {
      throw this.validationError("schemaVersion", "schemaVersion must be a positive integer");
    }

    return value as number;
  }

  private requireUuid(value: unknown, field: string): string {
    const text = this.requireString(value, field);
    if (!UUID_PATTERN.test(text)) {
      throw this.validationError(field, `${field} must be a UUID`);
    }

    return text;
  }

  private requireString(value: unknown, field: string): string {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw this.validationError(field, `${field} is required`);
    }

    return value.trim();
  }

  private readOptionalString(value: unknown, field: string): string | undefined {
    if (value === undefined || value === null || value === "") {
      return undefined;
    }

    return this.requireString(value, field);
  }

  private readNullableString(value: unknown, field: string): string | undefined {
    if (value === undefined || value === null || value === "") {
      return undefined;
    }

    return this.requireString(value, field);
  }

  private readPage(value: unknown): number {
    return this.readPositiveInteger(value, "page", DEFAULT_PAGE, Number.MAX_SAFE_INTEGER);
  }

  private readSize(value: unknown): number {
    return this.readPositiveInteger(value, "size", DEFAULT_SIZE, MAX_SIZE);
  }

  private readPositiveInteger(value: unknown, field: string, fallback: number, max: number): number {
    if (value === undefined || value === null || value === "") {
      return fallback;
    }

    const parsed = typeof value === "number" ? value : Number(value);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
      throw this.validationError(field, `${field} must be an integer between 1 and ${max}`);
    }

    return parsed;
  }

  private toResponse(item: AuditLogModel): AuditLogResponse {
    return {
      auditId: item.auditId,
      eventId: item.eventId,
      occurredAt: item.occurredAt.toISOString(),
      tenantId: item.tenantId,
      actor: {
        type: item.actorType,
        ...(item.actorType === AuditActorType.user ? { userId: item.actorId } : {}),
        ...(item.actorType === AuditActorType.service ? { serviceId: item.actorId } : {})
      },
      action: item.action,
      resource: {
        type: item.resourceType,
        id: item.resourceId
      },
      result: item.result,
      requestId: item.requestId,
      reason: item.reason,
      details: item.details,
      createdAt: item.createdAt.toISOString()
    };
  }

  private isJsonValue(value: unknown): boolean {
    if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      return true;
    }

    if (Array.isArray(value)) {
      return value.every((item) => this.isJsonValue(item));
    }

    if (typeof value === "object") {
      return Object.values(value).every((item) => this.isJsonValue(item));
    }

    return false;
  }

  private findSensitiveDetailPath(value: unknown, path = ""): string | undefined {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        const result = this.findSensitiveDetailPath(value[index], `${path}[${index}]`);
        if (result) {
          return result;
        }
      }
    }

    if (typeof value === "object" && value !== null) {
      for (const [key, child] of Object.entries(value)) {
        const normalizedKey = key.replace(/[-_\s]/g, "").toLowerCase();
        const nextPath = path ? `${path}.${key}` : key;
        if (SENSITIVE_DETAIL_KEYS.includes(normalizedKey)) {
          return nextPath;
        }

        const result = this.findSensitiveDetailPath(child, nextPath);
        if (result) {
          return result;
        }
      }
    }

    return undefined;
  }

  private validationError(field: string, message: string): BadRequestException {
    return new BadRequestException({
      code: "VALIDATION_FAILED",
      message: "Validation failed",
      details: {
        fields: {
          [field]: message
        }
      }
    });
  }
}

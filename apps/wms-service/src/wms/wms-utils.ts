import { BadRequestException } from "@nestjs/common";

export interface CommandContext {
  tenantId?: string;
  userId?: string;
  requestId?: string;
}

export function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

export function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function readOptionalString(value: unknown): string | undefined {
  const result = readString(value);
  return result || undefined;
}

export function requireTenant(tenantId: string | undefined): string {
  if (!tenantId) {
    throw validationFailed(
      {
        tenantId: "X-Tenant-Id is required"
      },
      "TENANT_REQUIRED",
      "Tenant is required"
    );
  }

  return requireUuid(tenantId, "tenantId");
}

export function requireUser(userId: string | undefined): string {
  if (!userId) {
    throw validationFailed({
      userId: "X-User-Id is required"
    });
  }

  return requireUuid(userId, "userId");
}

export function requireUuid(value: string, fieldName: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw validationFailed({
      [fieldName]: `${fieldName} must be a UUID`
    });
  }

  return value;
}

export function readOptionalUuid(value: unknown, fieldName: string): string | undefined {
  const text = readOptionalString(value);
  return text ? requireUuid(text, fieldName) : undefined;
}

export function readCode(value: unknown, fieldName: string): string {
  const code = readString(value).toLowerCase();
  if (!code || !/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(code)) {
    throw validationFailed({
      [fieldName]: `${fieldName} must use lowercase dot/kebab/snake code format`
    });
  }

  return code;
}

export function readRequiredString(value: unknown, fieldName: string, maxLength = 200): string {
  const text = readOptionalString(value);
  if (!text) {
    throw validationFailed({
      [fieldName]: `${fieldName} is required`
    });
  }

  if (text.length > maxLength) {
    throw validationFailed({
      [fieldName]: `${fieldName} must be ${maxLength} characters or less`
    });
  }

  return text;
}

export function readDecimal(value: unknown, fieldName: string): number {
  const parsed = typeof value === "number" ? value : Number(readString(value));
  if (!Number.isFinite(parsed) || parsed === 0) {
    throw validationFailed({
      [fieldName]: `${fieldName} must be a non-zero number`
    });
  }

  return roundQuantity(parsed);
}

export function readPositiveDecimal(value: unknown, fieldName: string): number {
  const parsed = typeof value === "number" ? value : Number(readString(value));
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw validationFailed({
      [fieldName]: `${fieldName} must be a positive number`
    });
  }

  return roundQuantity(parsed);
}

export function readPage(value: unknown): number {
  const page = Number(value ?? 1);
  if (!Number.isInteger(page) || page < 1) {
    throw validationFailed({
      page: "page must be an integer greater than or equal to 1"
    });
  }

  return page;
}

export function readSize(value: unknown): number {
  const size = Number(value ?? 20);
  if (!Number.isInteger(size) || size < 1 || size > 100) {
    throw validationFailed({
      size: "size must be an integer between 1 and 100"
    });
  }

  return size;
}

export function validationFailed(
  fields: Record<string, string>,
  code = "VALIDATION_FAILED",
  message = "Validation failed"
): BadRequestException {
  return new BadRequestException({
    code,
    message,
    details: {
      fields
    }
  });
}

function roundQuantity(value: number): number {
  return Math.round(value * 1000) / 1000;
}

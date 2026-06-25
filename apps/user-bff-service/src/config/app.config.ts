import { randomUUID } from "node:crypto";

export type AppEnvironment = "local" | "dev" | "staging" | "prod" | "test";

export interface AppConfig {
  serviceName: "user-bff-service";
  env: AppEnvironment;
  nodeEnv: string;
  port: number;
  logLevel: string;
  awsRegion: string;
  requestIdHeader: string;
  tenantHeader: string;
  securityHeadersEnabled: boolean;
  cors: {
    allowedOrigins: string[];
    allowedMethods: string[];
    allowedHeaders: string[];
    exposedHeaders: string[];
    credentials: boolean;
    maxAgeSeconds: number;
  };
  downstream: {
    authIamServiceUrl: string;
    tenantServiceUrl: string;
    wmsServiceUrl: string;
    auditLogServiceUrl?: string;
    timeoutMs: number;
    safeMethodRetries: number;
  };
  internalAuth: {
    enabled: boolean;
    serviceId: string;
    authSecret: string;
    tenantSecret: string;
    wmsSecret: string;
    auditSecret: string;
    timestampSkewSeconds: number;
  };
  audit: {
    publisherType: "eventbridge" | "internal-api" | "disabled";
    eventBridgeBusName?: string;
    eventBridgeEndpoint?: string;
    eventSourcePrefix: string;
  };
}

const DEFAULT_PORT = 3000;
const SAFE_DEFAULT_TIMEOUT_MS = 5000;

function parseInteger(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`${name} must be an integer`);
  }

  return parsed;
}

function parseBoolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

function parseCsv(name: string, fallback: string[]): string[] {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function readRequiredUrl(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }

  try {
    return new URL(value).toString().replace(/\/$/, "");
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }
}

function readOptionalUrl(name: string): string | undefined {
  const value = process.env[name]?.trim();
  if (!value) {
    return undefined;
  }

  try {
    return new URL(value).toString().replace(/\/$/, "");
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }
}

function readRequiredSecret(name: string, enabled: boolean): string {
  const value = process.env[name]?.trim();
  if (!enabled) {
    return value ?? "";
  }

  if (!value || value.length < 16) {
    throw new Error(`${name} is required and must be at least 16 characters`);
  }

  return value;
}

function readAuditPublisherType(eventBridgeBusName?: string): AppConfig["audit"]["publisherType"] {
  const raw = process.env.USER_BFF_APP_AUDIT_PUBLISHER_TYPE?.trim();
  if (!raw) {
    return eventBridgeBusName ? "eventbridge" : "internal-api";
  }

  if (raw === "eventbridge" || raw === "internal-api" || raw === "disabled") {
    return raw;
  }

  throw new Error("USER_BFF_APP_AUDIT_PUBLISHER_TYPE must be eventbridge, internal-api, or disabled");
}

export function loadAppConfig(): AppConfig {
  const env = (process.env.APP_ENV ?? "local") as AppEnvironment;
  const internalAuthEnabled = parseBoolean("USER_BFF_INTERNAL_AUTH_ENABLED", true);
  const auditEventBridgeBusName = process.env.USER_BFF_AUDIT_EVENTBRIDGE_BUS_NAME?.trim() || undefined;
  const auditPublisherType = readAuditPublisherType(auditEventBridgeBusName);
  const auditLogServiceUrl =
    auditPublisherType === "internal-api" ? readRequiredUrl("AUDIT_LOG_SERVICE_URL") : readOptionalUrl("AUDIT_LOG_SERVICE_URL");
  const auditSecretRequired = internalAuthEnabled && auditPublisherType === "internal-api";

  if (auditPublisherType === "eventbridge" && !auditEventBridgeBusName) {
    throw new Error("USER_BFF_AUDIT_EVENTBRIDGE_BUS_NAME is required when app audit publisher is eventbridge");
  }

  return {
    serviceName: "user-bff-service",
    env,
    nodeEnv: process.env.NODE_ENV ?? "development",
    port: parseInteger("USER_BFF_PORT", DEFAULT_PORT),
    logLevel: process.env.LOG_LEVEL ?? "info",
    awsRegion: process.env.AWS_REGION ?? "ap-northeast-2",
    requestIdHeader: process.env.REQUEST_ID_HEADER ?? "x-request-id",
    tenantHeader: process.env.TENANT_HEADER ?? "x-tenant-id",
    securityHeadersEnabled: parseBoolean("USER_BFF_SECURITY_HEADERS_ENABLED", true),
    cors: {
      allowedOrigins: parseCsv("USER_BFF_CORS_ALLOWED_ORIGINS", [
        "http://localhost:3000",
        "http://127.0.0.1:3000"
      ]),
      allowedMethods: parseCsv("USER_BFF_CORS_ALLOWED_METHODS", [
        "GET",
        "POST",
        "PUT",
        "PATCH",
        "DELETE",
        "OPTIONS"
      ]),
      allowedHeaders: parseCsv("USER_BFF_CORS_ALLOWED_HEADERS", [
        "Authorization",
        "Content-Type",
        "Accept",
        "X-Request-Id",
        "X-Tenant-Id",
        "X-User-Id",
        "Idempotency-Key"
      ]),
      exposedHeaders: parseCsv("USER_BFF_CORS_EXPOSED_HEADERS", ["X-Request-Id", "X-Tenant-Id"]),
      credentials: parseBoolean("USER_BFF_CORS_CREDENTIALS", true),
      maxAgeSeconds: parseInteger("USER_BFF_CORS_MAX_AGE_SECONDS", 600)
    },
    downstream: {
      authIamServiceUrl: readRequiredUrl("AUTH_IAM_SERVICE_URL"),
      tenantServiceUrl: readRequiredUrl("TENANT_SERVICE_URL"),
      wmsServiceUrl: readRequiredUrl("WMS_SERVICE_URL"),
      auditLogServiceUrl,
      timeoutMs: parseInteger("USER_BFF_DOWNSTREAM_TIMEOUT_MS", SAFE_DEFAULT_TIMEOUT_MS),
      safeMethodRetries: parseInteger("USER_BFF_SAFE_METHOD_RETRIES", 1)
    },
    internalAuth: {
      enabled: internalAuthEnabled,
      serviceId: process.env.USER_BFF_INTERNAL_SERVICE_ID ?? "user-bff-service",
      authSecret: readRequiredSecret("AUTH_INTERNAL_AUTH_SECRET", internalAuthEnabled),
      tenantSecret: readRequiredSecret("TENANT_INTERNAL_AUTH_SECRET", internalAuthEnabled),
      wmsSecret: readRequiredSecret("WMS_INTERNAL_AUTH_SECRET", internalAuthEnabled),
      auditSecret: readRequiredSecret("AUDIT_INTERNAL_AUTH_SECRET", auditSecretRequired),
      timestampSkewSeconds: parseInteger("USER_BFF_INTERNAL_AUTH_TIMESTAMP_SKEW_SECONDS", 300)
    },
    audit: {
      publisherType: auditPublisherType,
      eventBridgeBusName: auditEventBridgeBusName,
      eventBridgeEndpoint: readOptionalUrl("USER_BFF_AUDIT_EVENTBRIDGE_ENDPOINT"),
      eventSourcePrefix: process.env.USER_BFF_AUDIT_EVENT_SOURCE_PREFIX?.trim() ?? ""
    }
  };
}

export function createRequestId(): string {
  return randomUUID();
}

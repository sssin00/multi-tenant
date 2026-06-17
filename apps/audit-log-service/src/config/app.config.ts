export interface AppConfig {
  port: number;
  serviceName: string;
  env: AppEnvironment;
  requestIdHeader: string;
  tenantHeader: string;
  cors: CorsConfig;
  securityHeaders: SecurityHeadersConfig;
  internalAuth: InternalAuthConfig;
  eventConsumer: AuditEventConsumerConfig;
}

export type AppEnvironment = "local" | "dev" | "staging" | "prod";

export interface InternalAuthConfig {
  enabled: boolean;
  secret?: string;
  allowedServices: string[];
  timestampSkewSeconds: number;
}

export interface CorsConfig {
  allowedOrigins: string[];
  allowedMethods: string[];
  allowedHeaders: string[];
  exposedHeaders: string[];
  credentials: boolean;
  maxAgeSeconds: number;
}

export interface SecurityHeadersConfig {
  enabled: boolean;
}

export interface AuditEventConsumerConfig {
  enabled: boolean;
  queueUrl?: string;
  sqsEndpoint?: string;
  pollIntervalMs: number;
  waitTimeSeconds: number;
  visibilityTimeoutSeconds: number;
  batchSize: number;
}

const DEFAULT_AUDIT_PORT = 3006;

export function getAppConfig(): AppConfig {
  return {
    port: readNumber("AUDIT_PORT", DEFAULT_AUDIT_PORT),
    serviceName: "audit-log-service",
    env: readAppEnvironment("APP_ENV", "local"),
    requestIdHeader: readString("REQUEST_ID_HEADER", "x-request-id"),
    tenantHeader: readString("TENANT_HEADER", "x-tenant-id"),
    cors: {
      allowedOrigins: readStringList("AUDIT_CORS_ALLOWED_ORIGINS", defaultCorsOrigins()),
      allowedMethods: readStringList("AUDIT_CORS_ALLOWED_METHODS", ["GET", "OPTIONS"]),
      allowedHeaders: readStringList("AUDIT_CORS_ALLOWED_HEADERS", [
        "Authorization",
        "Content-Type",
        "Accept",
        "X-Request-Id",
        "X-Tenant-Id",
        "X-User-Id",
        "Idempotency-Key",
        "X-Internal-Service-Id",
        "X-Internal-Timestamp",
        "X-Internal-Signature"
      ]),
      exposedHeaders: readStringList("AUDIT_CORS_EXPOSED_HEADERS", ["X-Request-Id", "X-Tenant-Id"]),
      credentials: readBoolean("AUDIT_CORS_CREDENTIALS", true),
      maxAgeSeconds: readNumber("AUDIT_CORS_MAX_AGE_SECONDS", 600)
    },
    securityHeaders: {
      enabled: readBoolean("AUDIT_SECURITY_HEADERS_ENABLED", true)
    },
    internalAuth: {
      enabled: readBoolean("AUDIT_INTERNAL_AUTH_ENABLED", true),
      secret: readOptionalString("AUDIT_INTERNAL_AUTH_SECRET"),
      allowedServices: readStringList("AUDIT_INTERNAL_AUTH_ALLOWED_SERVICES", ["admin-bff-service"]),
      timestampSkewSeconds: readNumber("AUDIT_INTERNAL_AUTH_TIMESTAMP_SKEW_SECONDS", 300)
    },
    eventConsumer: {
      enabled: readBoolean("AUDIT_EVENT_CONSUMER_ENABLED", false),
      queueUrl: readOptionalString("AUDIT_EVENT_QUEUE_URL"),
      sqsEndpoint: readOptionalString("AUDIT_EVENT_SQS_ENDPOINT"),
      pollIntervalMs: readNumber("AUDIT_EVENT_POLL_INTERVAL_MS", 5000),
      waitTimeSeconds: readNumber("AUDIT_EVENT_WAIT_TIME_SECONDS", 10),
      visibilityTimeoutSeconds: readNumber("AUDIT_EVENT_VISIBILITY_TIMEOUT_SECONDS", 60),
      batchSize: readNumber("AUDIT_EVENT_BATCH_SIZE", 10)
    }
  };
}

function readAppEnvironment(name: string, fallback: AppEnvironment): AppEnvironment {
  const value = readString(name, fallback);
  if (value === "local" || value === "dev" || value === "staging" || value === "prod") {
    return value;
  }

  return fallback;
}

function readString(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : fallback;
}

function readOptionalString(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

function readStringList(name: string, fallback: string[]): string[] {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function readNumber(name: string, fallback: number): number {
  const rawValue = process.env[name];
  if (!rawValue) {
    return fallback;
  }

  const parsed = Number(rawValue);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readBoolean(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }

  return value.trim().toLowerCase() !== "false";
}

function defaultCorsOrigins(): string[] {
  const appEnv = readAppEnvironment("APP_ENV", "local");
  if (appEnv === "local") {
    return ["http://localhost:5173", "http://localhost:3000", "http://127.0.0.1:5173", "http://127.0.0.1:3000"];
  }

  return [];
}

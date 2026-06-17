export interface AppConfig {
  port: number;
  serviceName: string;
  env: AppEnvironment;
  requestIdHeader: string;
  tenantHeader: string;
  cors: CorsConfig;
  securityHeaders: SecurityHeadersConfig;
  worker: WorkerConfig;
  publisher: PublisherConfig;
  sources: SourceConfig[];
}

export type AppEnvironment = "local" | "dev" | "staging" | "prod";

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

export interface WorkerConfig {
  enabled: boolean;
  pollIntervalMs: number;
  batchSize: number;
  maxRetryCount: number;
  lockTimeoutSeconds: number;
}

export interface PublisherConfig {
  type: "mock" | "eventbridge" | "sqs";
  eventBridgeBusName?: string;
  eventSourcePrefix: string;
  sqsQueueUrl?: string;
  sqsEndpoint?: string;
  sqsMessageGroupStrategy: "aggregateId" | "tenantId" | "eventType";
}

export interface SourceConfig {
  name: OutboxSourceName;
  databaseUrl?: string;
}

export type OutboxSourceName = "auth-iam" | "tenant" | "wms";

const DEFAULT_OUTBOX_PORT = 3007;
const DEFAULT_SOURCES: OutboxSourceName[] = ["auth-iam", "tenant"];

export function getAppConfig(): AppConfig {
  const sources = readSourceNames("OUTBOX_SOURCES", DEFAULT_SOURCES);

  return {
    port: readNumber("OUTBOX_PORT", DEFAULT_OUTBOX_PORT),
    serviceName: "outbox-relay-service",
    env: readAppEnvironment("APP_ENV", "local"),
    requestIdHeader: readString("REQUEST_ID_HEADER", "x-request-id"),
    tenantHeader: readString("TENANT_HEADER", "x-tenant-id"),
    cors: {
      allowedOrigins: readStringList("OUTBOX_CORS_ALLOWED_ORIGINS", defaultCorsOrigins()),
      allowedMethods: readStringList("OUTBOX_CORS_ALLOWED_METHODS", ["GET", "OPTIONS"]),
      allowedHeaders: readStringList("OUTBOX_CORS_ALLOWED_HEADERS", ["Authorization", "Content-Type", "Accept", "X-Request-Id", "X-Tenant-Id"]),
      exposedHeaders: readStringList("OUTBOX_CORS_EXPOSED_HEADERS", ["X-Request-Id", "X-Tenant-Id"]),
      credentials: readBoolean("OUTBOX_CORS_CREDENTIALS", true),
      maxAgeSeconds: readNumber("OUTBOX_CORS_MAX_AGE_SECONDS", 600)
    },
    securityHeaders: {
      enabled: readBoolean("OUTBOX_SECURITY_HEADERS_ENABLED", true)
    },
    worker: {
      enabled: readBoolean("OUTBOX_WORKER_ENABLED", true),
      pollIntervalMs: readNumber("OUTBOX_POLL_INTERVAL_MS", 5000),
      batchSize: readNumber("OUTBOX_BATCH_SIZE", 20),
      maxRetryCount: readNumber("OUTBOX_MAX_RETRY_COUNT", 5),
      lockTimeoutSeconds: readNumber("OUTBOX_LOCK_TIMEOUT_SECONDS", 60)
    },
    publisher: {
      type: readPublisherType("OUTBOX_PUBLISHER_TYPE", "mock"),
      eventBridgeBusName: readOptionalString("OUTBOX_EVENTBRIDGE_BUS_NAME"),
      eventSourcePrefix: readString("OUTBOX_EVENT_SOURCE_PREFIX", "multi-tenant"),
      sqsQueueUrl: readOptionalString("OUTBOX_SQS_QUEUE_URL"),
      sqsEndpoint: readOptionalString("OUTBOX_SQS_ENDPOINT"),
      sqsMessageGroupStrategy: readSqsMessageGroupStrategy("OUTBOX_SQS_MESSAGE_GROUP_STRATEGY", "aggregateId")
    },
    sources: sources.map((source) => ({
      name: source,
      databaseUrl: readSourceDatabaseUrl(source)
    }))
  };
}

function readSourceDatabaseUrl(source: OutboxSourceName): string | undefined {
  switch (source) {
    case "auth-iam":
      return readOptionalString("AUTH_IAM_OUTBOX_DATABASE_URL");
    case "tenant":
      return readOptionalString("TENANT_OUTBOX_DATABASE_URL");
    case "wms":
      return readOptionalString("WMS_OUTBOX_DATABASE_URL");
  }
}

function readAppEnvironment(name: string, fallback: AppEnvironment): AppEnvironment {
  const value = readString(name, fallback);
  if (value === "local" || value === "dev" || value === "staging" || value === "prod") {
    return value;
  }

  return fallback;
}

function readPublisherType(name: string, fallback: PublisherConfig["type"]): PublisherConfig["type"] {
  const value = readString(name, fallback);
  if (value === "mock" || value === "eventbridge" || value === "sqs") {
    return value;
  }

  return fallback;
}

function readSqsMessageGroupStrategy(
  name: string,
  fallback: PublisherConfig["sqsMessageGroupStrategy"]
): PublisherConfig["sqsMessageGroupStrategy"] {
  const value = readString(name, fallback);
  if (value === "aggregateId" || value === "tenantId" || value === "eventType") {
    return value;
  }

  return fallback;
}

function readSourceNames(name: string, fallback: OutboxSourceName[]): OutboxSourceName[] {
  const values = readStringList(name, fallback);
  const sources = values.filter((value): value is OutboxSourceName => value === "auth-iam" || value === "tenant" || value === "wms");
  return sources.length > 0 ? sources : fallback;
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

export interface AppConfig {
  port: number;
  serviceName: string;
  env: AppEnvironment;
  requestIdHeader: string;
  tenantHeader: string;
  cors: CorsConfig;
  securityHeaders: SecurityHeadersConfig;
  downstream: DownstreamConfig;
  internalAuth: InternalAuthConfig;
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

export interface DownstreamConfig {
  authIamServiceUrl: string;
  tenantServiceUrl: string;
  timeoutMs: number;
  retryCount: number;
}

export interface InternalAuthConfig {
  enabled: boolean;
  secret?: string;
  allowedServices: string[];
  serviceId: string;
  authIamSecret?: string;
  tenantSecret?: string;
  timestampSkewSeconds: number;
}

const DEFAULT_WMS_PORT = 3000;
const DEFAULT_SAFE_METHOD_RETRY_COUNT = 1;

export function getAppConfig(): AppConfig {
  return {
    port: readNumber("WMS_PORT", DEFAULT_WMS_PORT),
    serviceName: "wms-service",
    env: readAppEnvironment("APP_ENV", "local"),
    requestIdHeader: readString("REQUEST_ID_HEADER", "x-request-id"),
    tenantHeader: readString("TENANT_HEADER", "x-tenant-id"),
    cors: {
      allowedOrigins: readStringList("WMS_CORS_ALLOWED_ORIGINS", defaultCorsOrigins()),
      allowedMethods: readStringList("WMS_CORS_ALLOWED_METHODS", [
        "GET",
        "POST",
        "PUT",
        "PATCH",
        "DELETE",
        "OPTIONS"
      ]),
      allowedHeaders: readStringList("WMS_CORS_ALLOWED_HEADERS", [
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
      exposedHeaders: readStringList("WMS_CORS_EXPOSED_HEADERS", ["X-Request-Id", "X-Tenant-Id"]),
      credentials: readBoolean("WMS_CORS_CREDENTIALS", true),
      maxAgeSeconds: readNumber("WMS_CORS_MAX_AGE_SECONDS", 600)
    },
    securityHeaders: {
      enabled: readBoolean("WMS_SECURITY_HEADERS_ENABLED", true)
    },
    downstream: {
      authIamServiceUrl: readString("AUTH_IAM_SERVICE_URL", "http://auth-iam-service:3000"),
      tenantServiceUrl: readString("TENANT_SERVICE_URL", "http://tenant-service:3000"),
      timeoutMs: readNumber("WMS_DOWNSTREAM_TIMEOUT_MS", 5000),
      retryCount: readNumber("WMS_SAFE_METHOD_RETRIES", DEFAULT_SAFE_METHOD_RETRY_COUNT)
    },
    internalAuth: {
      enabled: readBoolean("WMS_INTERNAL_AUTH_ENABLED", true),
      secret: readOptionalString("WMS_INTERNAL_AUTH_SECRET"),
      allowedServices: readStringList("WMS_INTERNAL_AUTH_ALLOWED_SERVICES", [
        "admin-bff-service",
        "user-bff-service"
      ]),
      serviceId: readString("WMS_INTERNAL_SERVICE_ID", "wms-service"),
      authIamSecret: readOptionalString("AUTH_INTERNAL_AUTH_SECRET"),
      tenantSecret: readOptionalString("TENANT_INTERNAL_AUTH_SECRET"),
      timestampSkewSeconds: readNumber("WMS_INTERNAL_AUTH_TIMESTAMP_SKEW_SECONDS", 300)
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

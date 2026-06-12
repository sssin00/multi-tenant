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
  auditLogServiceUrl?: string;
  timeoutMs: number;
  retryCount: number;
}

export interface InternalAuthConfig {
  enabled: boolean;
  serviceId: string;
  authIamSecret?: string;
  tenantSecret?: string;
  auditLogSecret?: string;
  timestampSkewSeconds: number;
}

const DEFAULT_ADMIN_BFF_PORT = 3000;
const DEFAULT_SAFE_METHOD_RETRY_COUNT = 1;

export function getAppConfig(): AppConfig {
  return {
    port: readNumber("ADMIN_BFF_PORT", DEFAULT_ADMIN_BFF_PORT),
    serviceName: "admin-bff-service",
    env: readAppEnvironment("APP_ENV", "local"),
    requestIdHeader: readString("REQUEST_ID_HEADER", "x-request-id"),
    tenantHeader: readString("TENANT_HEADER", "x-tenant-id"),
    cors: {
      allowedOrigins: readStringList("ADMIN_BFF_CORS_ALLOWED_ORIGINS", defaultCorsOrigins()),
      allowedMethods: readStringList("ADMIN_BFF_CORS_ALLOWED_METHODS", [
        "GET",
        "POST",
        "PUT",
        "PATCH",
        "DELETE",
        "OPTIONS"
      ]),
      allowedHeaders: readStringList("ADMIN_BFF_CORS_ALLOWED_HEADERS", [
        "Authorization",
        "Content-Type",
        "Accept",
        "X-Request-Id",
        "X-Tenant-Id",
        "X-User-Id",
        "Idempotency-Key"
      ]),
      exposedHeaders: readStringList("ADMIN_BFF_CORS_EXPOSED_HEADERS", ["X-Request-Id", "X-Tenant-Id"]),
      credentials: readBoolean("ADMIN_BFF_CORS_CREDENTIALS", true),
      maxAgeSeconds: readNumber("ADMIN_BFF_CORS_MAX_AGE_SECONDS", 600)
    },
    securityHeaders: {
      enabled: readBoolean("ADMIN_BFF_SECURITY_HEADERS_ENABLED", true)
    },
    downstream: {
      authIamServiceUrl: readString("AUTH_IAM_SERVICE_URL", "http://auth-iam-service:3000"),
      tenantServiceUrl: readString("TENANT_SERVICE_URL", "http://tenant-service:3000"),
      auditLogServiceUrl: readOptionalString("AUDIT_LOG_SERVICE_URL"),
      timeoutMs: readNumber("ADMIN_BFF_DOWNSTREAM_TIMEOUT_MS", 5000),
      retryCount: readNumber("ADMIN_BFF_SAFE_METHOD_RETRIES", DEFAULT_SAFE_METHOD_RETRY_COUNT)
    },
    internalAuth: {
      enabled: readBoolean("ADMIN_BFF_INTERNAL_AUTH_ENABLED", true),
      serviceId: readString("ADMIN_BFF_INTERNAL_SERVICE_ID", "admin-bff-service"),
      authIamSecret: readOptionalString("AUTH_INTERNAL_AUTH_SECRET"),
      tenantSecret: readOptionalString("TENANT_INTERNAL_AUTH_SECRET"),
      auditLogSecret: readOptionalString("AUDIT_INTERNAL_AUTH_SECRET"),
      timestampSkewSeconds: readNumber("ADMIN_BFF_INTERNAL_AUTH_TIMESTAMP_SKEW_SECONDS", 300)
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

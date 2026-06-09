export interface AppConfig {
  port: number;
  serviceName: string;
  env: AppEnvironment;
  requestIdHeader: string;
  tenantHeader: string;
  cors: CorsConfig;
  securityHeaders: SecurityHeadersConfig;
  jwt: JwtConfig;
  auth: AuthConfig;
  internalAuth: InternalAuthConfig;
  redis: RedisConfig;
  audit: AuditConfig;
}

export type AppEnvironment = "local" | "dev" | "staging" | "prod";

export interface JwtConfig {
  algorithm: "HS256" | "RS256";
  secret?: string;
  privateKey?: string;
  publicKey?: string;
  issuer?: string;
  audience?: string;
}

export interface AuthConfig {
  accessTokenTtlSeconds: number;
  refreshTokenTtlSeconds: number;
}

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

export interface RedisConfig {
  url?: string;
}

export interface AuditConfig {
  serviceUrl?: string;
}

const DEFAULT_AUTH_PORT = 3000;

export function getAppConfig(): AppConfig {
  return {
    port: readNumber("AUTH_PORT", DEFAULT_AUTH_PORT),
    serviceName: "auth-iam-service",
    env: readAppEnvironment("APP_ENV", "local"),
    requestIdHeader: readString("REQUEST_ID_HEADER", "x-request-id"),
    tenantHeader: readString("TENANT_HEADER", "x-tenant-id"),
    cors: {
      allowedOrigins: readStringList("AUTH_CORS_ALLOWED_ORIGINS", defaultCorsOrigins()),
      allowedMethods: readStringList("AUTH_CORS_ALLOWED_METHODS", [
        "GET",
        "POST",
        "PUT",
        "PATCH",
        "DELETE",
        "OPTIONS"
      ]),
      allowedHeaders: readStringList("AUTH_CORS_ALLOWED_HEADERS", [
        "Authorization",
        "Content-Type",
        "Accept",
        "X-Request-Id",
        "X-Tenant-Id",
        "Idempotency-Key",
        "X-Internal-Service-Id",
        "X-Internal-Timestamp",
        "X-Internal-Signature"
      ]),
      exposedHeaders: readStringList("AUTH_CORS_EXPOSED_HEADERS", ["X-Request-Id", "X-Tenant-Id"]),
      credentials: readBoolean("AUTH_CORS_CREDENTIALS", true),
      maxAgeSeconds: readNumber("AUTH_CORS_MAX_AGE_SECONDS", 600)
    },
    securityHeaders: {
      enabled: readBoolean("AUTH_SECURITY_HEADERS_ENABLED", true)
    },
    jwt: {
      algorithm: readJwtAlgorithm("JWT_ALGORITHM", "HS256"),
      secret: readOptionalString("JWT_SECRET"),
      privateKey: normalizePem(readOptionalString("JWT_PRIVATE_KEY")),
      publicKey: normalizePem(readOptionalString("JWT_PUBLIC_KEY")),
      issuer: readOptionalString("JWT_ISSUER"),
      audience: readOptionalString("JWT_AUDIENCE")
    },
    auth: {
      accessTokenTtlSeconds: readNumber("AUTH_ACCESS_TOKEN_TTL_SECONDS", 1800),
      refreshTokenTtlSeconds: readNumber("AUTH_REFRESH_TOKEN_TTL_SECONDS", 1_209_600)
    },
    internalAuth: {
      enabled: readBoolean("AUTH_INTERNAL_AUTH_ENABLED", true),
      secret: readOptionalString("AUTH_INTERNAL_AUTH_SECRET"),
      allowedServices: readStringList("AUTH_INTERNAL_AUTH_ALLOWED_SERVICES", [
        "admin-bff-service",
        "user-bff-service",
        "wms-service"
      ]),
      timestampSkewSeconds: readNumber("AUTH_INTERNAL_AUTH_TIMESTAMP_SKEW_SECONDS", 300)
    },
    redis: {
      url: readOptionalString("REDIS_URL")
    },
    audit: {
      serviceUrl: readOptionalString("AUDIT_LOG_SERVICE_URL")
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

function readJwtAlgorithm(name: string, fallback: JwtConfig["algorithm"]): JwtConfig["algorithm"] {
  const value = readString(name, fallback);
  return value === "RS256" ? "RS256" : "HS256";
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

  return value.toLowerCase() === "true";
}

function defaultCorsOrigins(): string[] {
  const appEnv = readAppEnvironment("APP_ENV", "local");
  if (appEnv === "local") {
    return ["http://localhost:5173", "http://localhost:3000", "http://127.0.0.1:5173", "http://127.0.0.1:3000"];
  }

  return [];
}

function normalizePem(value: string | undefined): string | undefined {
  return value?.replace(/\\n/g, "\n");
}

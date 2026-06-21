export interface AppConfig {
  port: number;
  serviceName: string;
  env: AppEnvironment;
  requestIdHeader: string;
  tenantHeader: string;
  cors: CorsConfig;
  securityHeaders: SecurityHeadersConfig;
  jwt: JwtConfig;
  redis: RedisConfig;
  rateLimit: RateLimitConfig;
  routes: {
    auth: ProxyRouteConfig;
    admin: ProxyRouteConfig;
    app: ProxyRouteConfig;
  };
}

export type AppEnvironment = "local" | "dev" | "staging" | "prod";

export interface JwtConfig {
  algorithm: "HS256" | "RS256";
  secret?: string;
  publicKey?: string;
  issuer?: string;
  audience?: string;
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

export interface RateLimitConfig {
  enabled: boolean;
  windowSeconds: number;
  limits: Record<ProxyRouteConfig["key"], number>;
}

export interface ProxyRouteConfig {
  key: "auth" | "admin" | "app";
  publicPathPrefix: string;
  upstreamUrl: string;
  timeoutMs: number;
  retryCount: number;
}

const DEFAULT_GATEWAY_PORT = 3000;
const DEFAULT_SAFE_METHOD_RETRY_COUNT = 1;

export function getAppConfig(): AppConfig {
  return {
    port: readNumber("GATEWAY_PORT", DEFAULT_GATEWAY_PORT),
    serviceName: "gateway-service",
    env: readAppEnvironment("APP_ENV", "local"),
    requestIdHeader: readString("REQUEST_ID_HEADER", "x-request-id"),
    tenantHeader: readString("TENANT_HEADER", "x-tenant-id"),
    cors: {
      allowedOrigins: readStringList("GATEWAY_CORS_ALLOWED_ORIGINS", defaultCorsOrigins()),
      allowedMethods: readStringList("GATEWAY_CORS_ALLOWED_METHODS", [
        "GET",
        "POST",
        "PUT",
        "PATCH",
        "DELETE",
        "OPTIONS"
      ]),
      allowedHeaders: readStringList("GATEWAY_CORS_ALLOWED_HEADERS", [
        "Authorization",
        "Content-Type",
        "Accept",
        "X-Request-Id",
        "X-Tenant-Id",
        "Idempotency-Key"
      ]),
      exposedHeaders: readStringList("GATEWAY_CORS_EXPOSED_HEADERS", [
        "X-Request-Id",
        "X-Tenant-Id",
        "X-RateLimit-Limit",
        "X-RateLimit-Remaining",
        "X-RateLimit-Reset"
      ]),
      credentials: readBoolean("GATEWAY_CORS_CREDENTIALS", true),
      maxAgeSeconds: readNumber("GATEWAY_CORS_MAX_AGE_SECONDS", 600)
    },
    securityHeaders: {
      enabled: readBoolean("GATEWAY_SECURITY_HEADERS_ENABLED", true)
    },
    jwt: {
      algorithm: readJwtAlgorithm("JWT_ALGORITHM", "HS256"),
      secret: readOptionalString("JWT_SECRET"),
      publicKey: normalizePem(readOptionalString("JWT_PUBLIC_KEY")),
      issuer: readOptionalString("JWT_ISSUER"),
      audience: readOptionalString("JWT_AUDIENCE")
    },
    redis: {
      url: readOptionalString("REDIS_URL")
    },
    rateLimit: {
      enabled: readBoolean("GATEWAY_RATE_LIMIT_ENABLED", true),
      windowSeconds: readNumber("GATEWAY_RATE_LIMIT_WINDOW_SECONDS", 60),
      limits: {
        auth: readNumber("GATEWAY_RATE_LIMIT_AUTH_PER_WINDOW", 60),
        admin: readNumber("GATEWAY_RATE_LIMIT_ADMIN_PER_WINDOW", 300),
        app: readNumber("GATEWAY_RATE_LIMIT_APP_PER_WINDOW", 600)
      }
    },
    routes: {
      auth: {
        key: "auth",
        publicPathPrefix: "/api/auth",
        upstreamUrl: readString("AUTH_IAM_SERVICE_URL", "http://auth-iam-service:3000/api/auth"),
        timeoutMs: readNumber("GATEWAY_AUTH_UPSTREAM_TIMEOUT_MS", 3000),
        retryCount: readNumber("GATEWAY_SAFE_METHOD_RETRIES", DEFAULT_SAFE_METHOD_RETRY_COUNT)
      },
      admin: {
        key: "admin",
        publicPathPrefix: "/api/admin",
        upstreamUrl: readString("ADMIN_BFF_SERVICE_URL", "http://admin-bff-service:3000/api/admin"),
        timeoutMs: readNumber("GATEWAY_ADMIN_UPSTREAM_TIMEOUT_MS", 5000),
        retryCount: readNumber("GATEWAY_SAFE_METHOD_RETRIES", DEFAULT_SAFE_METHOD_RETRY_COUNT)
      },
      app: {
        key: "app",
        publicPathPrefix: "/api/app",
        upstreamUrl: readString("USER_BFF_SERVICE_URL", "http://user-bff-service:3000/api/app"),
        timeoutMs: readNumber("GATEWAY_APP_UPSTREAM_TIMEOUT_MS", 5000),
        retryCount: readNumber("GATEWAY_SAFE_METHOD_RETRIES", DEFAULT_SAFE_METHOD_RETRY_COUNT)
      }
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

import { z } from "zod";
import type {
  AccessControlData,
  AdminDashboardData,
  AdminMe,
  AdminSession,
  ApiEnvelope,
  AuditLogItem,
  DataResult,
  PageData,
  TenantDomainItem,
  TenantDetail,
  TenantItem,
  UserItem,
  UserRoleItem
} from "./api-types";
import {
  sampleAccessControl,
  sampleAuditLogs,
  sampleDashboard,
  sampleTenants,
  sampleUserRoles
} from "./sample-data";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";
const sessionKey = "web-admin.session";

const envelopeSchema = z.object({
  success: z.boolean(),
  requestId: z.string(),
  timestamp: z.string(),
  data: z.unknown().optional(),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
      details: z.unknown().optional()
    })
    .optional()
});

const loginResponseSchema = z.object({
  accessToken: z.string().min(1),
  expiresIn: z.number().int().positive(),
  refreshToken: z.string().min(1),
  refreshExpiresIn: z.number().int().positive(),
  tokenType: z.literal("Bearer")
});

interface LoginResponse {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshExpiresIn: number;
  tokenType: "Bearer";
}

interface JwtClaims {
  sub?: string;
  tenantId?: string;
  type?: string;
}

export interface AdminListQuery {
  page?: number;
  size?: number;
  status?: string;
  keyword?: string;
  code?: string;
  name?: string;
  domain?: string;
  moduleCode?: string;
  email?: string;
  userStatus?: string;
  tenantFilter?: string;
  roleCode?: string;
  permissionCode?: string;
  action?: string;
  resourceType?: string;
  requestId?: string;
}

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly requestId?: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function loadSession(): AdminSession | null {
  const raw = window.localStorage.getItem(sessionKey);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as AdminSession;
  } catch {
    window.localStorage.removeItem(sessionKey);
    return null;
  }
}

export function saveSession(session: AdminSession): void {
  window.localStorage.setItem(sessionKey, JSON.stringify(session));
}

export function clearSession(): void {
  window.localStorage.removeItem(sessionKey);
}

export async function login(input: {
  email: string;
  password: string;
}): Promise<DataResult<AdminSession>> {
  const envelope = await requestEnvelope<unknown>("/api/auth/login", {
    method: "POST",
    body: {
      email: input.email.trim(),
      password: input.password
    },
    tenantId: null,
    authorization: null
  });
  const session = toSession(loginResponseSchema.parse(envelope.data), input.email);
  saveSession(session);
  return { data: session, source: "api", requestId: envelope.requestId };
}

export async function getAdminMe(): Promise<DataResult<AdminMe>> {
  const envelope = await requestEnvelope<AdminMe>("/api/admin/me");
  return { data: envelope.data as AdminMe, source: "api", requestId: envelope.requestId };
}

export async function getAdminDashboard(): Promise<DataResult<AdminDashboardData>> {
  return withSample(() => request<AdminDashboardData>("/api/admin/dashboard"), sampleDashboard);
}

export async function getTenants(query: AdminListQuery = {}): Promise<DataResult<PageData<TenantItem>>> {
  return withSample(() => request<PageData<TenantItem>>(withQuery("/api/admin/tenants", query)), sampleTenants);
}

export async function getTenant(tenantId: string): Promise<DataResult<TenantDetail>> {
  const envelope = await requestEnvelope<TenantDetail>(`/api/admin/tenants/${encodeURIComponent(tenantId)}`);
  return { data: envelope.data as TenantDetail, source: "api", requestId: envelope.requestId };
}

export async function createTenant(input: { name: string; domain?: string; contactPhone?: string }): Promise<TenantItem> {
  return request<TenantItem>("/api/admin/tenants", {
    method: "POST",
    body: input,
    idempotencyKey: createIdempotencyKey("tenant-create")
  });
}

export async function updateTenant(input: {
  tenantId: string;
  name: string;
  domain?: string;
  contactPhone?: string;
}): Promise<TenantItem> {
  return request<TenantItem>(`/api/admin/tenants/${encodeURIComponent(input.tenantId)}`, {
    method: "PATCH",
    body: {
      name: input.name,
      domain: input.domain,
      contactPhone: input.contactPhone ?? ""
    },
    idempotencyKey: createIdempotencyKey("tenant-update")
  });
}

export async function updateTenantStatus(input: {
  tenantId: string;
  status: string;
  reason?: string;
}): Promise<TenantItem> {
  return request<TenantItem>(`/api/admin/tenants/${encodeURIComponent(input.tenantId)}/status`, {
    method: "PATCH",
    body: {
      status: input.status,
      reason: input.reason
    },
    idempotencyKey: createIdempotencyKey("tenant-status")
  });
}

export async function replaceTenantModules(input: {
  tenantId: string;
  enabledModules: string[];
}): Promise<{ tenantId: string; enabledModules: string[] }> {
  return request<{ tenantId: string; enabledModules: string[] }>(
    `/api/admin/tenants/${encodeURIComponent(input.tenantId)}/modules`,
    {
      method: "PUT",
      body: {
        enabledModules: input.enabledModules
      },
      idempotencyKey: createIdempotencyKey("tenant-modules")
    }
  );
}

export async function getTenantDomains(tenantId: string): Promise<DataResult<{ items: TenantDomainItem[] }>> {
  return withSample(
    () => request<{ items: TenantDomainItem[] }>(`/api/admin/tenants/${encodeURIComponent(tenantId)}/domains`),
    { items: [] }
  );
}

export async function addTenantDomain(input: { tenantId: string; domain: string }): Promise<TenantDomainItem> {
  return request<TenantDomainItem>(`/api/admin/tenants/${encodeURIComponent(input.tenantId)}/domains`, {
    method: "POST",
    body: {
      domain: input.domain
    },
    idempotencyKey: createIdempotencyKey("tenant-domain-add")
  });
}

export async function deleteTenantDomain(input: {
  tenantId: string;
  domainId: string;
}): Promise<{ deleted: boolean } | TenantDomainItem> {
  return request<{ deleted: boolean } | TenantDomainItem>(
    `/api/admin/tenants/${encodeURIComponent(input.tenantId)}/domains/${encodeURIComponent(input.domainId)}`,
    {
      method: "DELETE",
      idempotencyKey: createIdempotencyKey("tenant-domain-delete")
    }
  );
}

export async function getAccessControlData(query: AdminListQuery = {}): Promise<DataResult<AccessControlData>> {
  return withSample(
    () => request<AccessControlData>(withQuery("/api/admin/access-control/screen-data", query)),
    sampleAccessControl
  );
}

export async function createUser(input: {
  email: string;
  displayName: string;
  password: string;
  status?: string;
  tenantId?: string | null;
  userType?: "general_user" | "system_admin";
}): Promise<UserItem> {
  return request<UserItem>("/api/admin/users", {
    method: "POST",
    tenantId: input.tenantId,
    body: {
      email: input.email.trim(),
      displayName: input.displayName.trim(),
      password: input.password,
      status: input.status ?? "active",
      userType: input.userType ?? "general_user"
    },
    idempotencyKey: createIdempotencyKey("admin-user-create")
  });
}

export async function updateUser(input: {
  userId: string;
  email: string;
  displayName: string;
  tenantId?: string | null;
}): Promise<UserItem> {
  return request<UserItem>(`/api/admin/users/${encodeURIComponent(input.userId)}`, {
    method: "PATCH",
    tenantId: input.tenantId,
    body: {
      email: input.email.trim(),
      displayName: input.displayName.trim()
    },
    idempotencyKey: createIdempotencyKey("admin-user-update")
  });
}

export async function assignUserRole(input: {
  userId: string;
  roleId: string;
  warehouseId?: string;
  tenantId?: string;
}): Promise<UserRoleItem> {
  return request<UserRoleItem>(`/api/admin/users/${encodeURIComponent(input.userId)}/roles`, {
    method: "POST",
    tenantId: input.tenantId,
    body: {
      roleId: input.roleId,
      warehouseId: input.warehouseId?.trim() || undefined
    },
    idempotencyKey: createIdempotencyKey("admin-user-role-assign")
  });
}

export async function getUserRoles(userId: string): Promise<DataResult<{ items: UserRoleItem[] }>> {
  return withSample(
    () => request<{ items: UserRoleItem[] }>(`/api/admin/users/${encodeURIComponent(userId)}/roles`),
    sampleUserRoles
  );
}

export async function updateUserStatus(input: { userId: string; status: string; tenantId?: string | null }): Promise<UserItem> {
  return request<UserItem>(`/api/admin/users/${encodeURIComponent(input.userId)}/status`, {
    method: "PATCH",
    tenantId: input.tenantId,
    body: {
      status: input.status
    },
    idempotencyKey: createIdempotencyKey("admin-user-status")
  });
}

export async function removeUserRole(userRoleId: string): Promise<{ removed: boolean }> {
  return request<{ removed: boolean }>(`/api/admin/user-roles/${encodeURIComponent(userRoleId)}`, {
    method: "DELETE",
    idempotencyKey: createIdempotencyKey("admin-user-role-remove")
  });
}

export async function replaceRolePermissions(input: {
  roleId: string;
  permissionCodes: string[];
}): Promise<{ id?: string; roleId?: string; code: string; permissions?: string[]; permissionCodes?: string[] }> {
  return request<{ id?: string; roleId?: string; code: string; permissions?: string[]; permissionCodes?: string[] }>(
    `/api/admin/roles/${encodeURIComponent(input.roleId)}/permissions`,
    {
      method: "PUT",
      body: {
        permissionCodes: input.permissionCodes
      },
      idempotencyKey: createIdempotencyKey("admin-role-permissions")
    }
  );
}

export async function getAuditLogs(query: AdminListQuery = {}): Promise<DataResult<PageData<AuditLogItem>>> {
  return withSample(() => request<PageData<AuditLogItem>>(withQuery("/api/admin/audit-logs", query)), sampleAuditLogs);
}

async function withSample<T>(fetcher: () => Promise<T>, sample: T): Promise<DataResult<T>> {
  try {
    const data = await fetcher();
    return { data, source: "api" };
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    return {
      data: sample,
      source: "sample",
      message: error instanceof Error ? error.message : "API 연결 실패"
    };
  }
}

async function request<T>(
  path: string,
  options: {
    method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
    body?: unknown;
    tenantId?: string | null;
    authorization?: string | null;
    idempotencyKey?: string;
  } = {}
): Promise<T> {
  const parsed = await requestEnvelope<T>(path, options);

  return parsed.data as T;
}

async function requestEnvelope<T>(
  path: string,
  options: {
    method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
    body?: unknown;
    tenantId?: string | null;
    authorization?: string | null;
    idempotencyKey?: string;
  } = {}
): Promise<ApiEnvelope<T>> {
  const session = loadSession();
  const headers = new Headers({
    Accept: "application/json",
    "Content-Type": "application/json",
    "X-Request-Id": createRequestId()
  });
  const tenantId = options.tenantId === undefined ? session?.tenantId : options.tenantId;
  const authorization = options.authorization === null ? null : options.authorization ?? session?.accessToken;

  if (tenantId) {
    headers.set("X-Tenant-Id", tenantId);
  }
  if (authorization) {
    headers.set("Authorization", `Bearer ${authorization}`);
  }
  if (options.idempotencyKey) {
    headers.set("Idempotency-Key", options.idempotencyKey);
  }

  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const parsed = envelopeSchema.parse((await response.json()) as ApiEnvelope<T>);

  if (!response.ok || !parsed.success) {
    throw new ApiError(
      parsed.error?.code ?? `HTTP_${response.status}`,
      parsed.error?.message ?? "요청에 실패했습니다.",
      parsed.requestId
    );
  }

  return parsed as ApiEnvelope<T>;
}

function toSession(data: LoginResponse, email: string): AdminSession {
  const claims = decodeJwtClaims(data.accessToken);
  const normalizedEmail = email.trim().toLowerCase();

  return {
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
    expiresIn: data.expiresIn,
    refreshExpiresIn: data.refreshExpiresIn,
    tokenType: data.tokenType,
    tenantId: claims.tenantId ?? null,
    user: {
      userId: claims.sub ?? "",
      email: normalizedEmail,
      displayName: normalizedEmail.split("@")[0] || "관리자"
    }
  };
}

function decodeJwtClaims(token: string): JwtClaims {
  const [, payload] = token.split(".");
  if (!payload) {
    return {};
  }

  try {
    const base64 = payload.replaceAll("-", "+").replaceAll("_", "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    return JSON.parse(window.atob(padded)) as JwtClaims;
  } catch {
    return {};
  }
}

function createRequestId(): string {
  if (window.crypto.randomUUID) {
    return window.crypto.randomUUID();
  }

  return `web-admin-${Date.now()}`;
}

function createIdempotencyKey(prefix: string): string {
  if (window.crypto.randomUUID) {
    return `${prefix}-${window.crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}`;
}

function withQuery(path: string, query: AdminListQuery): string {
  const params = new URLSearchParams();
  const page = query.page ?? 1;
  const size = query.size ?? 20;

  params.set("page", String(page));
  params.set("size", String(size));

  Object.entries(query).forEach(([key, value]) => {
    if (key === "page" || key === "size") {
      return;
    }

    const normalized = typeof value === "string" ? value.trim() : value;
    if (normalized !== undefined && normalized !== null && normalized !== "") {
      params.set(key, String(normalized));
    }
  });

  return `${path}?${params.toString()}`;
}

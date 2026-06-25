import { z } from "zod";
import type {
  AppMe,
  AppNavigation,
  ApiEnvelope,
  AuthSession,
  DataResult,
  InventorySnapshots,
  InventorySummary,
  InventoryAdjustmentResult,
  InboundConfirmationResult,
  LocationItem,
  MaterialItem,
  OutboundAllocationItem,
  OutboundPackageResult,
  OutboundPackingItem,
  OutboundShipmentResult,
  PageData,
  WarehouseItem,
  WmsDashboard
} from "./api-types";
import {
  sampleAllocations,
  sampleDashboard,
  sampleInventory,
  sampleLocations,
  sampleMaterials,
  samplePackings,
  sampleSnapshots,
  sampleWarehouses
} from "./sample-data";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";
const sessionKey = "web-wms.session";

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

export interface WmsListQuery {
  page?: number;
  size?: number;
  code?: string;
  sku?: string;
  warehouseId?: string;
  locationId?: string;
  itemId?: string;
  snapshotDate?: string;
  outboundOrderId?: string;
  status?: string;
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

export function loadSession(): AuthSession | null {
  const raw = window.localStorage.getItem(sessionKey);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as AuthSession;
  } catch {
    window.localStorage.removeItem(sessionKey);
    return null;
  }
}

export function saveSession(session: AuthSession): void {
  window.localStorage.setItem(sessionKey, JSON.stringify(session));
}

export function clearSession(): void {
  window.localStorage.removeItem(sessionKey);
}

export async function login(input: {
  tenantId: string;
  email: string;
  password: string;
}): Promise<DataResult<AuthSession>> {
  const tenantId = input.tenantId.trim();
  const email = input.email.trim();
  const envelope = await requestEnvelope<unknown>("/api/auth/login", {
    method: "POST",
    body: {
      tenantId,
      email,
      password: input.password
    },
    tenantId,
    authorization: null
  });
  const session = toSession(loginResponseSchema.parse(envelope.data), tenantId, email);
  saveSession(session);
  return { data: session, source: "api", requestId: envelope.requestId };
}

export async function getAppMe(): Promise<DataResult<AppMe>> {
  const envelope = await requestEnvelope<AppMe>("/api/app/me");
  return { data: envelope.data as AppMe, source: "api", requestId: envelope.requestId };
}

export async function getNavigation(): Promise<DataResult<AppNavigation>> {
  const envelope = await requestEnvelope<AppNavigation>("/api/app/navigation");
  return { data: envelope.data as AppNavigation, source: "api", requestId: envelope.requestId };
}

export async function getDashboard(): Promise<DataResult<WmsDashboard>> {
  return withSample(() => request<WmsDashboard>("/api/app/wms/dashboard"), sampleDashboard);
}

export async function getInventorySummary(query: WmsListQuery = {}): Promise<DataResult<InventorySummary>> {
  return withSample(
    () => request<InventorySummary>(withQuery("/api/app/wms/inventory-summary", query)),
    sampleInventory
  );
}

export async function getInventorySnapshots(query: WmsListQuery = {}): Promise<DataResult<InventorySnapshots>> {
  const snapshotDate = query.snapshotDate?.trim() || getDefaultSnapshotDate();

  return withSample(
    () => request<InventorySnapshots>(withQuery("/api/app/wms/inventory-snapshots", { ...query, snapshotDate })),
    sampleSnapshots
  );
}

export async function getWarehouses(query: WmsListQuery = {}): Promise<DataResult<PageData<WarehouseItem>>> {
  return withSample(() => request<PageData<WarehouseItem>>(withQuery("/api/app/wms/warehouses", query)), sampleWarehouses);
}

export async function getLocations(query: WmsListQuery = {}): Promise<DataResult<PageData<LocationItem>>> {
  return withSample(() => request<PageData<LocationItem>>(withQuery("/api/app/wms/locations", query)), sampleLocations);
}

export async function getMaterials(query: WmsListQuery = {}): Promise<DataResult<PageData<MaterialItem>>> {
  return withSample(() => request<PageData<MaterialItem>>(withQuery("/api/app/wms/materials", query)), sampleMaterials);
}

export async function getOutboundAllocations(query: WmsListQuery = {}): Promise<DataResult<PageData<OutboundAllocationItem>>> {
  return withSample(
    () => request<PageData<OutboundAllocationItem>>(withQuery("/api/app/wms/outbound-allocations", query)),
    sampleAllocations
  );
}

export async function getOutboundPackings(query: WmsListQuery = {}): Promise<DataResult<PageData<OutboundPackingItem>>> {
  return withSample(
    () => request<PageData<OutboundPackingItem>>(withQuery("/api/app/wms/outbound-packings", query)),
    samplePackings
  );
}

export async function adjustInventory(input: {
  warehouseId: string;
  locationId: string;
  itemId: string;
  quantityChange: string;
  reason: string;
  referenceNo?: string;
  memo?: string;
  effectiveDate?: string;
}): Promise<DataResult<InventoryAdjustmentResult>> {
  return mutationRequest<InventoryAdjustmentResult>("/api/app/wms/inventory/adjustments", normalizeBody(input));
}

export async function confirmInbound(input: {
  warehouseId: string;
  locationId: string;
  itemId: string;
  quantity: string;
  referenceNo?: string;
}): Promise<DataResult<InboundConfirmationResult>> {
  return mutationRequest<InboundConfirmationResult>("/api/app/wms/inbound/confirmations", normalizeBody(input));
}

export async function allocateOutbound(input: {
  orderNo: string;
  warehouseId: string;
  locationId: string;
  itemId: string;
  quantity: string;
}): Promise<DataResult<OutboundAllocationItem>> {
  return mutationRequest<OutboundAllocationItem>("/api/app/wms/outbound/allocations", normalizeBody(input));
}

export async function createOutboundPacking(input: {
  outboundOrderId?: string;
  allocationIds: string[];
  memo?: string;
}): Promise<DataResult<OutboundPackingItem>> {
  return mutationRequest<OutboundPackingItem>("/api/app/wms/outbound/packings", normalizeBody(input));
}

export async function addOutboundPackage(input: {
  packingId: string;
  packageNo: string;
  boxType?: string;
  allocationId: string;
  itemId: string;
  quantity: string;
}): Promise<DataResult<OutboundPackageResult>> {
  return mutationRequest<OutboundPackageResult>(
    `/api/app/wms/outbound/packings/${encodeURIComponent(input.packingId)}/packages`,
    normalizeBody({
      packageNo: input.packageNo,
      boxType: input.boxType,
      items: [
        {
          allocationId: input.allocationId,
          itemId: input.itemId,
          quantity: input.quantity
        }
      ]
    })
  );
}

export async function confirmOutboundPacking(input: { packingId: string }): Promise<DataResult<OutboundPackingItem>> {
  return mutationRequest<OutboundPackingItem>(
    `/api/app/wms/outbound/packings/${encodeURIComponent(input.packingId)}/confirm`,
    undefined
  );
}

export async function shipOutbound(input: {
  allocationId?: string;
  packingId?: string;
  carrierCode?: string;
  trackingNo?: string;
  shippedAt?: string;
}): Promise<DataResult<OutboundShipmentResult>> {
  return mutationRequest<OutboundShipmentResult>("/api/app/wms/outbound/shipments", normalizeBody(input));
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
    method?: "GET" | "POST";
    body?: unknown;
    tenantId?: string;
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
    method?: "GET" | "POST";
    body?: unknown;
    tenantId?: string;
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
  const tenantId = options.tenantId ?? session?.tenantId;
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

async function mutationRequest<T>(path: string, body: unknown): Promise<DataResult<T>> {
  const envelope = await requestEnvelope<T>(path, {
    method: "POST",
    body,
    idempotencyKey: createIdempotencyKey("web-wms-mutation")
  });

  return {
    data: envelope.data as T,
    source: "api",
    requestId: envelope.requestId
  };
}

function toSession(data: LoginResponse, tenantId: string, email: string): AuthSession {
  const claims = decodeJwtClaims(data.accessToken);
  const normalizedEmail = email.trim().toLowerCase();

  return {
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
    expiresIn: data.expiresIn,
    refreshExpiresIn: data.refreshExpiresIn,
    tokenType: data.tokenType,
    tenantId: claims.tenantId ?? tenantId,
    user: {
      userId: claims.sub ?? "",
      email: normalizedEmail,
      displayName: normalizedEmail.split("@")[0] || "사용자"
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

  return `web-wms-${Date.now()}`;
}

function createIdempotencyKey(prefix: string): string {
  if (window.crypto.randomUUID) {
    return `${prefix}-${window.crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}`;
}

function normalizeBody<T extends Record<string, unknown>>(input: T): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input)
      .map(([key, value]) => [key, typeof value === "string" ? value.trim() : value])
      .filter(([, value]) => {
        if (Array.isArray(value)) {
          return value.length > 0;
        }
        return value !== undefined && value !== null && value !== "";
      })
  );
}

export function getDefaultSnapshotDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function withQuery(path: string, query: WmsListQuery): string {
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

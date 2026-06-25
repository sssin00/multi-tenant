import { Injectable } from "@nestjs/common";
import { loadAppConfig } from "../config/app.config.js";
import type { RequestContext } from "../context/request-context.js";
import { InternalHttpClient } from "./internal-http.client.js";

export interface PageData<T> {
  items: T[];
  page: number;
  size: number;
  total: number;
}

export interface WmsWarehouse {
  warehouseId: string;
  tenantId: string;
  code: string;
  name: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface WmsItem {
  itemId: string;
  tenantId: string;
  sku: string;
  name: string;
  uom: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface WmsLocation {
  locationId: string;
  tenantId: string;
  warehouseId: string;
  code: string;
  name: string | null;
  type: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface WmsInventoryBalance {
  balanceId: string;
  tenantId: string;
  warehouseId: string;
  locationId: string;
  itemId: string;
  quantity: string;
  allocatedQuantity: string;
  availableQuantity: string;
  updatedAt: string;
}

export interface WmsInventorySnapshot {
  snapshotId: string;
  tenantId: string;
  snapshotDate: string;
  snapshotAt: string;
  warehouseId: string;
  locationId: string;
  itemId: string;
  quantity: string;
  allocatedQuantity: string;
  availableQuantity: string;
  sourceLedgerId: string | null;
  runId: string;
  previousSnapshotId: string | null;
  isCurrent: boolean;
  generatedAt: string;
}

export interface WmsOutboundPacking {
  packingId: string;
  tenantId: string;
  outboundOrderId: string;
  orderNo: string;
  warehouseId: string;
  status: string;
  allocationIds: string[];
  packageIds: string[];
  packageCount: number;
  memo: string | null;
  packedBy: string | null;
  confirmedBy: string | null;
  confirmedAt: string | null;
  shippedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WmsOutboundAllocation {
  allocationId: string;
  outboundOrderId: string;
  tenantId: string;
  orderNo: string;
  warehouseId: string;
  locationId: string;
  itemId: string;
  quantity: string;
  status: string;
  allocatedBy: string | null;
  allocatedAt: string;
  shippedBy: string | null;
  shippedAt: string | null;
}

export interface WmsInventoryAdjustment {
  adjustmentId: string;
  tenantId: string;
  warehouseId: string;
  locationId: string;
  itemId: string;
  quantityChange: string;
  reason: string;
  referenceNo: string | null;
  memo: string | null;
  adjustedBy: string | null;
  effectiveDate: string;
  correctedLedgerId: string | null;
  correctionReason: string | null;
  createdAt: string;
}

export interface WmsInboundReceipt {
  receiptId: string;
  tenantId: string;
  warehouseId: string;
  locationId: string;
  itemId: string;
  quantity: string;
  referenceNo: string | null;
  confirmedBy: string | null;
  confirmedAt: string;
  createdAt: string;
}

export interface WmsOutboundPackage {
  packageId: string;
  tenantId: string;
  packingId: string;
  packageNo: string;
  boxType: string | null;
  weight: string | null;
  width: string | null;
  height: string | null;
  depth: string | null;
  items: Array<{
    packageItemId: string;
    allocationId: string;
    itemId: string;
    quantity: string;
  }>;
  createdAt: string;
  updatedAt: string;
}

export interface WmsOutboundShipment {
  shipmentId: string;
  tenantId: string;
  packingId: string | null;
  allocationId: string | null;
  outboundOrderId: string;
  orderNo: string;
  warehouseId: string;
  carrierCode: string | null;
  trackingNo: string | null;
  shippedBy: string | null;
  shippedAt: string;
  createdAt: string;
}

export interface WmsListQuery {
  page?: string | number;
  size?: string | number;
  code?: string;
  sku?: string;
  warehouseId?: string;
  locationId?: string;
  itemId?: string;
  snapshotDate?: string;
  outboundOrderId?: string;
  status?: string;
}

@Injectable()
export class WmsInternalClient {
  private readonly config = loadAppConfig();

  constructor(private readonly http: InternalHttpClient) {}

  async listWarehouses(context: RequestContext, query: WmsListQuery): Promise<PageData<WmsWarehouse>> {
    return this.getPage<WmsWarehouse>(context, "/warehouses", query);
  }

  async listItems(context: RequestContext, query: WmsListQuery): Promise<PageData<WmsItem>> {
    return this.getPage<WmsItem>(context, "/items", query);
  }

  async listLocations(context: RequestContext, query: WmsListQuery): Promise<PageData<WmsLocation>> {
    return this.getPage<WmsLocation>(context, "/locations", query);
  }

  async listInventory(context: RequestContext, query: WmsListQuery): Promise<PageData<WmsInventoryBalance>> {
    return this.getPage<WmsInventoryBalance>(context, "/inventory", query);
  }

  async listInventorySnapshots(context: RequestContext, query: WmsListQuery): Promise<PageData<WmsInventorySnapshot>> {
    return this.getPage<WmsInventorySnapshot>(context, "/inventory/snapshots", query);
  }

  async listOutboundPackings(context: RequestContext, query: WmsListQuery): Promise<PageData<WmsOutboundPacking>> {
    return this.getPage<WmsOutboundPacking>(context, "/outbound/packings", query);
  }

  async listOutboundAllocations(context: RequestContext, query: WmsListQuery): Promise<PageData<WmsOutboundAllocation>> {
    return this.getPage<WmsOutboundAllocation>(context, "/outbound/allocations", query);
  }

  async adjustInventory(context: RequestContext, body: unknown, idempotencyKey: string): Promise<WmsInventoryAdjustment> {
    return this.post<WmsInventoryAdjustment>(context, "/inventory/adjustments", body, idempotencyKey);
  }

  async confirmInbound(context: RequestContext, body: unknown, idempotencyKey: string): Promise<WmsInboundReceipt> {
    return this.post<WmsInboundReceipt>(context, "/inbound/confirmations", body, idempotencyKey);
  }

  async allocateOutbound(context: RequestContext, body: unknown, idempotencyKey: string): Promise<WmsOutboundAllocation> {
    return this.post<WmsOutboundAllocation>(context, "/outbound/allocations", body, idempotencyKey);
  }

  async createOutboundPacking(context: RequestContext, body: unknown, idempotencyKey: string): Promise<WmsOutboundPacking> {
    return this.post<WmsOutboundPacking>(context, "/outbound/packings", body, idempotencyKey);
  }

  async addOutboundPackage(
    context: RequestContext,
    packingId: string,
    body: unknown,
    idempotencyKey: string
  ): Promise<WmsOutboundPackage> {
    return this.post<WmsOutboundPackage>(
      context,
      `/outbound/packings/${encodeURIComponent(packingId)}/packages`,
      body,
      idempotencyKey
    );
  }

  async confirmOutboundPacking(context: RequestContext, packingId: string, idempotencyKey: string): Promise<WmsOutboundPacking> {
    return this.post<WmsOutboundPacking>(
      context,
      `/outbound/packings/${encodeURIComponent(packingId)}/confirm`,
      undefined,
      idempotencyKey
    );
  }

  async shipOutbound(
    context: RequestContext,
    body: unknown,
    idempotencyKey: string
  ): Promise<WmsOutboundAllocation | WmsOutboundShipment> {
    return this.post<WmsOutboundAllocation | WmsOutboundShipment>(context, "/outbound/shipments", body, idempotencyKey);
  }

  private async getPage<T>(context: RequestContext, path: string, query: WmsListQuery): Promise<PageData<T>> {
    return this.http.request<PageData<T>>({
      target: "wms",
      baseUrl: this.config.downstream.wmsServiceUrl,
      method: "GET",
      path: `/api/internal/wms${path}${this.toSearch(query)}`,
      context
    });
  }

  private async post<T>(context: RequestContext, path: string, body: unknown, idempotencyKey: string): Promise<T> {
    return this.http.request<T>({
      target: "wms",
      baseUrl: this.config.downstream.wmsServiceUrl,
      method: "POST",
      path: `/api/internal/wms${path}`,
      context,
      body,
      idempotencyKey
    });
  }

  private toSearch(query: WmsListQuery): string {
    const searchParams = new URLSearchParams();

    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === "") {
        continue;
      }

      searchParams.set(key, String(value));
    }

    const search = searchParams.toString();
    return search ? `?${search}` : "";
  }
}

import { Injectable } from "@nestjs/common";
import type { RequestContext } from "../context/request-context.js";
import { AuthIamInternalClient } from "../internal-clients/auth-iam-internal.client.js";
import {
  PageData,
  WmsInternalClient,
  WmsInventoryBalance,
  WmsInventoryAdjustment,
  WmsInventorySnapshot,
  WmsInboundReceipt,
  WmsItem,
  WmsListQuery,
  WmsLocation,
  WmsOutboundAllocation,
  WmsOutboundPackage,
  WmsOutboundPacking,
  WmsOutboundShipment,
  WmsWarehouse
} from "../internal-clients/wms-internal.client.js";

interface QuantityTotals {
  quantity: string;
  allocatedQuantity: string;
  availableQuantity: string;
}

type QuantitySource = Pick<WmsInventoryBalance, "quantity" | "allocatedQuantity" | "availableQuantity">;

interface WarehouseListItem {
  warehouseId: string;
  code: string;
  name: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

interface MaterialListItem {
  materialId: string;
  code: string;
  name: string;
  uom: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

interface LocationListItem {
  locationId: string;
  warehouseId: string;
  code: string;
  name: string | null;
  type: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

interface InventorySummaryItem {
  balanceId: string;
  warehouseId: string;
  locationId: string;
  materialId: string;
  quantity: string;
  allocatedQuantity: string;
  availableQuantity: string;
  updatedAt: string;
}

interface InventorySnapshotItem {
  snapshotId: string;
  snapshotDate: string;
  snapshotAt: string;
  warehouseId: string;
  locationId: string;
  materialId: string;
  quantity: string;
  allocatedQuantity: string;
  availableQuantity: string;
  sourceLedgerId: string | null;
  runId: string;
  previousSnapshotId: string | null;
  generatedAt: string;
}

export interface OutboundPackingListItem {
  packingId: string;
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

export interface OutboundAllocationListItem {
  allocationId: string;
  outboundOrderId: string;
  orderNo: string;
  warehouseId: string;
  locationId: string;
  materialId: string;
  quantity: string;
  status: string;
  allocatedBy: string | null;
  allocatedAt: string;
  shippedBy: string | null;
  shippedAt: string | null;
}

export interface WarehouseListResponse extends PageData<WarehouseListItem> {}

export interface MaterialListResponse extends PageData<MaterialListItem> {}

export interface LocationListResponse extends PageData<LocationListItem> {}

export interface InventorySummaryResponse {
  pageTotals: QuantityTotals;
  inventory: PageData<InventorySummaryItem>;
}

export interface InventorySnapshotListResponse {
  pageTotals: QuantityTotals;
  snapshots: PageData<InventorySnapshotItem>;
}

export interface OutboundPackingListResponse extends PageData<OutboundPackingListItem> {}

export interface OutboundAllocationListResponse extends PageData<OutboundAllocationListItem> {}

export interface InventoryAdjustmentResponse extends WmsInventoryAdjustment {}

export interface InboundConfirmationResponse extends WmsInboundReceipt {}

export interface OutboundAllocationMutationResponse extends OutboundAllocationListItem {}

export interface OutboundPackingMutationResponse extends OutboundPackingListItem {}

export interface OutboundPackageMutationResponse extends WmsOutboundPackage {}

export type OutboundShipmentMutationResponse = OutboundAllocationMutationResponse | WmsOutboundShipment;

export interface WmsDashboardResponse {
  inventory: {
    totalBalances: number;
    sampledBalanceCount: number;
    pageTotals: QuantityTotals;
  };
  operations: {
    outboundAllocations: {
      canView: boolean;
      total: number | null;
      sampledCount: number;
    };
    outboundPackings: {
      canView: boolean;
      total: number | null;
      sampledCount: number;
    };
  };
  visibleActions: {
    inventory: boolean;
    warehouses: boolean;
    materials: boolean;
    snapshots: boolean;
    packing: boolean;
    shipping: boolean;
  };
}

@Injectable()
export class WmsScreenService {
  constructor(
    private readonly authClient: AuthIamInternalClient,
    private readonly wmsClient: WmsInternalClient
  ) {}

  async listWarehouses(context: RequestContext, query: WmsListQuery): Promise<WarehouseListResponse> {
    const page = await this.wmsClient.listWarehouses(context, query);

    return {
      ...page,
      items: page.items.map((warehouse) => this.toWarehouseListItem(warehouse))
    };
  }

  async listMaterials(context: RequestContext, query: WmsListQuery): Promise<MaterialListResponse> {
    const page = await this.wmsClient.listItems(context, query);

    return {
      ...page,
      items: page.items.map((item) => this.toMaterialListItem(item))
    };
  }

  async listLocations(context: RequestContext, query: WmsListQuery): Promise<LocationListResponse> {
    const page = await this.wmsClient.listLocations(context, query);

    return {
      ...page,
      items: page.items.map((location) => this.toLocationListItem(location))
    };
  }

  async getInventorySummary(context: RequestContext, query: WmsListQuery): Promise<InventorySummaryResponse> {
    const page = await this.wmsClient.listInventory(context, query);
    const items = page.items.map((item) => this.toInventorySummaryItem(item));

    return {
      pageTotals: this.sumQuantities(page.items),
      inventory: {
        ...page,
        items
      }
    };
  }

  async listInventorySnapshots(context: RequestContext, query: WmsListQuery): Promise<InventorySnapshotListResponse> {
    const page = await this.wmsClient.listInventorySnapshots(context, query);
    const items = page.items.map((item) => this.toInventorySnapshotItem(item));

    return {
      pageTotals: this.sumQuantities(page.items),
      snapshots: {
        ...page,
        items
      }
    };
  }

  async listOutboundPackings(context: RequestContext, query: WmsListQuery): Promise<OutboundPackingListResponse> {
    const page = await this.wmsClient.listOutboundPackings(context, query);

    return {
      ...page,
      items: page.items.map((item) => this.toOutboundPackingListItem(item))
    };
  }

  async listOutboundAllocations(context: RequestContext, query: WmsListQuery): Promise<OutboundAllocationListResponse> {
    const page = await this.wmsClient.listOutboundAllocations(context, query);

    return {
      ...page,
      items: page.items.map((item) => this.toOutboundAllocationListItem(item))
    };
  }

  async adjustInventory(context: RequestContext, body: unknown, idempotencyKey: string): Promise<InventoryAdjustmentResponse> {
    return this.wmsClient.adjustInventory(context, body, idempotencyKey);
  }

  async confirmInbound(context: RequestContext, body: unknown, idempotencyKey: string): Promise<InboundConfirmationResponse> {
    return this.wmsClient.confirmInbound(context, body, idempotencyKey);
  }

  async allocateOutbound(context: RequestContext, body: unknown, idempotencyKey: string): Promise<OutboundAllocationMutationResponse> {
    const allocation = await this.wmsClient.allocateOutbound(context, body, idempotencyKey);
    return this.toOutboundAllocationListItem(allocation);
  }

  async createOutboundPacking(context: RequestContext, body: unknown, idempotencyKey: string): Promise<OutboundPackingMutationResponse> {
    const packing = await this.wmsClient.createOutboundPacking(context, body, idempotencyKey);
    return this.toOutboundPackingListItem(packing);
  }

  async addOutboundPackage(
    context: RequestContext,
    packingId: string,
    body: unknown,
    idempotencyKey: string
  ): Promise<OutboundPackageMutationResponse> {
    return this.wmsClient.addOutboundPackage(context, packingId, body, idempotencyKey);
  }

  async confirmOutboundPacking(
    context: RequestContext,
    packingId: string,
    idempotencyKey: string
  ): Promise<OutboundPackingMutationResponse> {
    const packing = await this.wmsClient.confirmOutboundPacking(context, packingId, idempotencyKey);
    return this.toOutboundPackingListItem(packing);
  }

  async shipOutbound(
    context: RequestContext,
    body: unknown,
    idempotencyKey: string
  ): Promise<OutboundShipmentMutationResponse> {
    const result = await this.wmsClient.shipOutbound(context, body, idempotencyKey);
    return "shipmentId" in result ? result : this.toOutboundAllocationListItem(result);
  }

  async getDashboard(context: RequestContext): Promise<WmsDashboardResponse> {
    const [inventory, permissions] = await Promise.all([
      this.wmsClient.listInventory(context, { page: 1, size: 100 }),
      this.authClient.getPermissionSummary(context)
    ]);
    const permissionSet = new Set(permissions.permissions);
    const canViewAllocations = permissionSet.has("wms.outbound.allocate");
    const canViewPackings = permissionSet.has("wms.outbound.pack");
    const [outboundAllocations, outboundPackings] = await Promise.all([
      canViewAllocations ? this.wmsClient.listOutboundAllocations(context, { page: 1, size: 20 }) : Promise.resolve(null),
      canViewPackings ? this.wmsClient.listOutboundPackings(context, { page: 1, size: 20 }) : Promise.resolve(null)
    ]);

    return {
      inventory: {
        totalBalances: inventory.total,
        sampledBalanceCount: inventory.items.length,
        pageTotals: this.sumQuantities(inventory.items)
      },
      operations: {
        outboundAllocations: {
          canView: canViewAllocations,
          total: outboundAllocations?.total ?? null,
          sampledCount: outboundAllocations?.items.length ?? 0
        },
        outboundPackings: {
          canView: canViewPackings,
          total: outboundPackings?.total ?? null,
          sampledCount: outboundPackings?.items.length ?? 0
        }
      },
      visibleActions: {
        inventory: permissionSet.has("wms.inventory.read"),
        warehouses: permissionSet.has("wms.warehouses.manage"),
        materials: permissionSet.has("wms.items.manage"),
        snapshots: permissionSet.has("wms.inventory.snapshot.generate"),
        packing: permissionSet.has("wms.outbound.pack"),
        shipping: permissionSet.has("wms.outbound.ship")
      }
    };
  }

  private toWarehouseListItem(warehouse: WmsWarehouse): WarehouseListItem {
    return {
      warehouseId: warehouse.warehouseId,
      code: warehouse.code,
      name: warehouse.name,
      status: warehouse.status,
      createdAt: warehouse.createdAt,
      updatedAt: warehouse.updatedAt
    };
  }

  private toMaterialListItem(item: WmsItem): MaterialListItem {
    return {
      materialId: item.itemId,
      code: item.sku,
      name: item.name,
      uom: item.uom,
      status: item.status,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt
    };
  }

  private toLocationListItem(location: WmsLocation): LocationListItem {
    return {
      locationId: location.locationId,
      warehouseId: location.warehouseId,
      code: location.code,
      name: location.name,
      type: location.type,
      status: location.status,
      createdAt: location.createdAt,
      updatedAt: location.updatedAt
    };
  }

  private toInventorySummaryItem(balance: WmsInventoryBalance): InventorySummaryItem {
    return {
      balanceId: balance.balanceId,
      warehouseId: balance.warehouseId,
      locationId: balance.locationId,
      materialId: balance.itemId,
      quantity: balance.quantity,
      allocatedQuantity: balance.allocatedQuantity,
      availableQuantity: balance.availableQuantity,
      updatedAt: balance.updatedAt
    };
  }

  private toInventorySnapshotItem(snapshot: WmsInventorySnapshot): InventorySnapshotItem {
    return {
      snapshotId: snapshot.snapshotId,
      snapshotDate: snapshot.snapshotDate,
      snapshotAt: snapshot.snapshotAt,
      warehouseId: snapshot.warehouseId,
      locationId: snapshot.locationId,
      materialId: snapshot.itemId,
      quantity: snapshot.quantity,
      allocatedQuantity: snapshot.allocatedQuantity,
      availableQuantity: snapshot.availableQuantity,
      sourceLedgerId: snapshot.sourceLedgerId,
      runId: snapshot.runId,
      previousSnapshotId: snapshot.previousSnapshotId,
      generatedAt: snapshot.generatedAt
    };
  }

  private toOutboundPackingListItem(packing: WmsOutboundPacking): OutboundPackingListItem {
    return {
      packingId: packing.packingId,
      outboundOrderId: packing.outboundOrderId,
      orderNo: packing.orderNo,
      warehouseId: packing.warehouseId,
      status: packing.status,
      allocationIds: packing.allocationIds,
      packageIds: packing.packageIds,
      packageCount: packing.packageCount,
      memo: packing.memo,
      packedBy: packing.packedBy,
      confirmedBy: packing.confirmedBy,
      confirmedAt: packing.confirmedAt,
      shippedAt: packing.shippedAt,
      createdAt: packing.createdAt,
      updatedAt: packing.updatedAt
    };
  }

  private toOutboundAllocationListItem(allocation: WmsOutboundAllocation): OutboundAllocationListItem {
    return {
      allocationId: allocation.allocationId,
      outboundOrderId: allocation.outboundOrderId,
      orderNo: allocation.orderNo,
      warehouseId: allocation.warehouseId,
      locationId: allocation.locationId,
      materialId: allocation.itemId,
      quantity: allocation.quantity,
      status: allocation.status,
      allocatedBy: allocation.allocatedBy,
      allocatedAt: allocation.allocatedAt,
      shippedBy: allocation.shippedBy,
      shippedAt: allocation.shippedAt
    };
  }

  private sumQuantities(items: QuantitySource[]): QuantityTotals {
    return {
      quantity: this.sumQuantity(items, (item) => item.quantity),
      allocatedQuantity: this.sumQuantity(items, (item) => item.allocatedQuantity),
      availableQuantity: this.sumQuantity(items, (item) => item.availableQuantity)
    };
  }

  private sumQuantity(
    items: QuantitySource[],
    selector: (item: QuantitySource) => string
  ): string {
    const total = items.reduce((sum, item) => {
      const value = Number(selector(item));
      return Number.isFinite(value) ? sum + value : sum;
    }, 0);

    return total.toFixed(3);
  }
}

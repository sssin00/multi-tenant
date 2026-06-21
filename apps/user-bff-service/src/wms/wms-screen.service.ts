import { Injectable } from "@nestjs/common";
import type { RequestContext } from "../context/request-context.js";
import { AuthIamInternalClient } from "../internal-clients/auth-iam-internal.client.js";
import {
  PageData,
  WmsInternalClient,
  WmsInventoryBalance,
  WmsItem,
  WmsListQuery,
  WmsWarehouse
} from "../internal-clients/wms-internal.client.js";

interface QuantityTotals {
  quantity: string;
  allocatedQuantity: string;
  availableQuantity: string;
}

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

export interface WarehouseListResponse extends PageData<WarehouseListItem> {}

export interface MaterialListResponse extends PageData<MaterialListItem> {}

export interface InventorySummaryResponse {
  pageTotals: QuantityTotals;
  inventory: PageData<InventorySummaryItem>;
}

export interface WmsDashboardResponse {
  inventory: {
    totalBalances: number;
    sampledBalanceCount: number;
    pageTotals: QuantityTotals;
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

  async getInventorySummary(context: RequestContext, query: WmsListQuery): Promise<InventorySummaryResponse> {
    const page = await this.wmsClient.listInventory(context, query);
    const items = page.items.map((item) => this.toInventorySummaryItem(item));

    return {
      pageTotals: this.sumInventory(page.items),
      inventory: {
        ...page,
        items
      }
    };
  }

  async getDashboard(context: RequestContext): Promise<WmsDashboardResponse> {
    const [inventory, permissions] = await Promise.all([
      this.wmsClient.listInventory(context, { page: 1, size: 100 }),
      this.authClient.getPermissionSummary(context)
    ]);
    const permissionSet = new Set(permissions.permissions);

    return {
      inventory: {
        totalBalances: inventory.total,
        sampledBalanceCount: inventory.items.length,
        pageTotals: this.sumInventory(inventory.items)
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

  private sumInventory(items: WmsInventoryBalance[]): QuantityTotals {
    return {
      quantity: this.sumQuantity(items, (item) => item.quantity),
      allocatedQuantity: this.sumQuantity(items, (item) => item.allocatedQuantity),
      availableQuantity: this.sumQuantity(items, (item) => item.availableQuantity)
    };
  }

  private sumQuantity(items: WmsInventoryBalance[], selector: (item: WmsInventoryBalance) => string): string {
    const total = items.reduce((sum, item) => {
      const value = Number(selector(item));
      return Number.isFinite(value) ? sum + value : sum;
    }, 0);

    return total.toFixed(3);
  }
}

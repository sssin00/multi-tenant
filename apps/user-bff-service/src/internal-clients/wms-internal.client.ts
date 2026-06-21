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

export interface WmsListQuery {
  page?: string | number;
  size?: string | number;
  code?: string;
  sku?: string;
  warehouseId?: string;
  locationId?: string;
  itemId?: string;
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

  async listInventory(context: RequestContext, query: WmsListQuery): Promise<PageData<WmsInventoryBalance>> {
    return this.getPage<WmsInventoryBalance>(context, "/inventory", query);
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

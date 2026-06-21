import { BadRequestException, Controller, Get, Query, Req, UseGuards } from "@nestjs/common";
import { AppPermission } from "../auth/app-permission.decorator.js";
import { AppPermissionGuard } from "../auth/app-permission.guard.js";
import { successEnvelope, SuccessEnvelope } from "../auth/response-envelope.js";
import type { RequestContext, RequestWithContext } from "../context/request-context.js";
import { TenantStatusGuard } from "../tenants/tenant-status.guard.js";
import {
  InventorySummaryResponse,
  MaterialListResponse,
  WarehouseListResponse,
  WmsDashboardResponse,
  WmsScreenService
} from "./wms-screen.service.js";

interface WmsQuery {
  page?: string;
  size?: string;
  code?: string;
  sku?: string;
  warehouseId?: string;
  locationId?: string;
  itemId?: string;
}

@Controller("api/app/wms")
@UseGuards(TenantStatusGuard, AppPermissionGuard)
export class WmsScreenController {
  constructor(private readonly wmsScreenService: WmsScreenService) {}

  @Get("warehouses")
  @AppPermission("wms.warehouses.manage")
  async listWarehouses(
    @Req() req: RequestWithContext,
    @Query() query: WmsQuery
  ): Promise<SuccessEnvelope<WarehouseListResponse>> {
    const context = this.requireContext(req);
    return successEnvelope(context, await this.wmsScreenService.listWarehouses(context, query));
  }

  @Get("materials")
  @AppPermission("wms.items.manage")
  async listMaterials(
    @Req() req: RequestWithContext,
    @Query() query: WmsQuery
  ): Promise<SuccessEnvelope<MaterialListResponse>> {
    const context = this.requireContext(req);
    return successEnvelope(context, await this.wmsScreenService.listMaterials(context, query));
  }

  @Get("inventory-summary")
  @AppPermission("wms.inventory.read")
  async getInventorySummary(
    @Req() req: RequestWithContext,
    @Query() query: WmsQuery
  ): Promise<SuccessEnvelope<InventorySummaryResponse>> {
    const context = this.requireContext(req);
    return successEnvelope(context, await this.wmsScreenService.getInventorySummary(context, query));
  }

  @Get("dashboard")
  @AppPermission("wms.inventory.read")
  async getDashboard(@Req() req: RequestWithContext): Promise<SuccessEnvelope<WmsDashboardResponse>> {
    const context = this.requireContext(req);
    return successEnvelope(context, await this.wmsScreenService.getDashboard(context));
  }

  private requireContext(req: RequestWithContext): RequestContext & { tenantId: string; userId: string } {
    const context = req.context;
    if (!context?.tenantId || !context.userId) {
      throw new BadRequestException({
        success: false,
        requestId: context?.requestId ?? "unknown",
        timestamp: new Date().toISOString(),
        error: {
          code: "REQUEST_CONTEXT_REQUIRED",
          message: "Tenant and user context are required"
        }
      });
    }

    return {
      requestId: context.requestId,
      tenantId: context.tenantId,
      userId: context.userId,
      ...(context.authorization ? { authorization: context.authorization } : {})
    };
  }
}

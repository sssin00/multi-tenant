import { BadRequestException, Body, Controller, Get, HttpCode, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { AppPermission } from "../auth/app-permission.decorator.js";
import { AppPermissionGuard } from "../auth/app-permission.guard.js";
import { successEnvelope, SuccessEnvelope } from "../auth/response-envelope.js";
import type { RequestContext, RequestWithContext } from "../context/request-context.js";
import { TenantStatusGuard } from "../tenants/tenant-status.guard.js";
import {
  InventorySnapshotListResponse,
  InventoryAdjustmentResponse,
  InventorySummaryResponse,
  InboundConfirmationResponse,
  LocationListResponse,
  MaterialListResponse,
  OutboundAllocationListResponse,
  OutboundAllocationMutationResponse,
  OutboundPackingListResponse,
  OutboundPackingMutationResponse,
  OutboundPackageMutationResponse,
  OutboundShipmentMutationResponse,
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
  snapshotDate?: string;
  outboundOrderId?: string;
  status?: string;
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

  @Get("locations")
  @AppPermission("wms.warehouses.manage")
  async listLocations(
    @Req() req: RequestWithContext,
    @Query() query: WmsQuery
  ): Promise<SuccessEnvelope<LocationListResponse>> {
    const context = this.requireContext(req);
    return successEnvelope(context, await this.wmsScreenService.listLocations(context, query));
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

  @HttpCode(201)
  @Post("inventory/adjustments")
  @AppPermission("wms.inventory.adjust")
  async adjustInventory(
    @Req() req: RequestWithContext,
    @Body() body: unknown
  ): Promise<SuccessEnvelope<InventoryAdjustmentResponse>> {
    const context = this.requireContext(req);
    return successEnvelope(context, await this.wmsScreenService.adjustInventory(context, body, this.requireIdempotencyKey(req)));
  }

  @HttpCode(201)
  @Post("inbound/confirmations")
  @AppPermission("wms.inbound.confirm")
  async confirmInbound(
    @Req() req: RequestWithContext,
    @Body() body: unknown
  ): Promise<SuccessEnvelope<InboundConfirmationResponse>> {
    const context = this.requireContext(req);
    return successEnvelope(context, await this.wmsScreenService.confirmInbound(context, body, this.requireIdempotencyKey(req)));
  }

  @Get("inventory-snapshots")
  @AppPermission("wms.inventory.read")
  async listInventorySnapshots(
    @Req() req: RequestWithContext,
    @Query() query: WmsQuery
  ): Promise<SuccessEnvelope<InventorySnapshotListResponse>> {
    const context = this.requireContext(req);
    return successEnvelope(context, await this.wmsScreenService.listInventorySnapshots(context, query));
  }

  @Get("outbound-packings")
  @AppPermission("wms.outbound.pack")
  async listOutboundPackings(
    @Req() req: RequestWithContext,
    @Query() query: WmsQuery
  ): Promise<SuccessEnvelope<OutboundPackingListResponse>> {
    const context = this.requireContext(req);
    return successEnvelope(context, await this.wmsScreenService.listOutboundPackings(context, query));
  }

  @Get("outbound-allocations")
  @AppPermission("wms.outbound.allocate")
  async listOutboundAllocations(
    @Req() req: RequestWithContext,
    @Query() query: WmsQuery
  ): Promise<SuccessEnvelope<OutboundAllocationListResponse>> {
    const context = this.requireContext(req);
    return successEnvelope(context, await this.wmsScreenService.listOutboundAllocations(context, query));
  }

  @HttpCode(201)
  @Post("outbound/allocations")
  @AppPermission("wms.outbound.allocate")
  async allocateOutbound(
    @Req() req: RequestWithContext,
    @Body() body: unknown
  ): Promise<SuccessEnvelope<OutboundAllocationMutationResponse>> {
    const context = this.requireContext(req);
    return successEnvelope(context, await this.wmsScreenService.allocateOutbound(context, body, this.requireIdempotencyKey(req)));
  }

  @HttpCode(201)
  @Post("outbound/packings")
  @AppPermission("wms.outbound.pack")
  async createOutboundPacking(
    @Req() req: RequestWithContext,
    @Body() body: unknown
  ): Promise<SuccessEnvelope<OutboundPackingMutationResponse>> {
    const context = this.requireContext(req);
    return successEnvelope(context, await this.wmsScreenService.createOutboundPacking(context, body, this.requireIdempotencyKey(req)));
  }

  @HttpCode(201)
  @Post("outbound/packings/:packingId/packages")
  @AppPermission("wms.outbound.pack")
  async addOutboundPackage(
    @Param("packingId") packingId: string,
    @Req() req: RequestWithContext,
    @Body() body: unknown
  ): Promise<SuccessEnvelope<OutboundPackageMutationResponse>> {
    const context = this.requireContext(req);
    return successEnvelope(context, await this.wmsScreenService.addOutboundPackage(context, packingId, body, this.requireIdempotencyKey(req)));
  }

  @HttpCode(200)
  @Post("outbound/packings/:packingId/confirm")
  @AppPermission("wms.outbound.pack")
  async confirmOutboundPacking(
    @Param("packingId") packingId: string,
    @Req() req: RequestWithContext
  ): Promise<SuccessEnvelope<OutboundPackingMutationResponse>> {
    const context = this.requireContext(req);
    return successEnvelope(context, await this.wmsScreenService.confirmOutboundPacking(context, packingId, this.requireIdempotencyKey(req)));
  }

  @HttpCode(200)
  @Post("outbound/shipments")
  @AppPermission("wms.outbound.ship")
  async shipOutbound(
    @Req() req: RequestWithContext,
    @Body() body: unknown
  ): Promise<SuccessEnvelope<OutboundShipmentMutationResponse>> {
    const context = this.requireContext(req);
    return successEnvelope(context, await this.wmsScreenService.shipOutbound(context, body, this.requireIdempotencyKey(req)));
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

  private requireIdempotencyKey(req: RequestWithContext): string {
    const value = req.headers["idempotency-key"];
    const idempotencyKey = Array.isArray(value) ? value[0] : value;
    if (!idempotencyKey) {
      throw new BadRequestException({
        success: false,
        requestId: req.context?.requestId ?? "unknown",
        timestamp: new Date().toISOString(),
        error: {
          code: "IDEMPOTENCY_KEY_REQUIRED",
          message: "Idempotency-Key header is required"
        }
      });
    }

    return idempotencyKey;
  }
}

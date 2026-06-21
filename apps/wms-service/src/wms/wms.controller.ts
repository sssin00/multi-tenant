import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from "@nestjs/common";

import type { WmsRequest } from "../context/request-context.js";
import { InternalService } from "../internal-auth/internal-service.decorator.js";
import { WmsService } from "./wms.service.js";

@Controller("api/internal/wms")
@InternalService({
  allowedServices: ["admin-bff-service", "user-bff-service"]
})
export class WmsController {
  constructor(
    @Inject(WmsService)
    private readonly wmsService: WmsService
  ) {}

  @Get("warehouses")
  async listWarehouses(@Query() query: Record<string, unknown>, @Req() req: WmsRequest) {
    return this.success(req, await this.wmsService.listWarehouses(req.context, query));
  }

  @HttpCode(201)
  @Post("warehouses")
  async createWarehouse(@Body() body: unknown, @Req() req: WmsRequest) {
    return this.success(req, await this.wmsService.createWarehouse(req.context, body));
  }

  @Get("locations")
  async listLocations(@Query() query: Record<string, unknown>, @Req() req: WmsRequest) {
    return this.success(req, await this.wmsService.listLocations(req.context, query));
  }

  @HttpCode(201)
  @Post("locations")
  async createLocation(@Body() body: unknown, @Req() req: WmsRequest) {
    return this.success(req, await this.wmsService.createLocation(req.context, body));
  }

  @Get("items")
  async listItems(@Query() query: Record<string, unknown>, @Req() req: WmsRequest) {
    return this.success(req, await this.wmsService.listItems(req.context, query));
  }

  @HttpCode(201)
  @Post("items")
  async createItem(@Body() body: unknown, @Req() req: WmsRequest) {
    return this.success(req, await this.wmsService.createItem(req.context, body));
  }

  @Get("inventory")
  async listInventory(@Query() query: Record<string, unknown>, @Req() req: WmsRequest) {
    return this.success(req, await this.wmsService.listInventory(req.context, query));
  }

  @Get("inventory/snapshots")
  async listInventorySnapshots(@Query() query: Record<string, unknown>, @Req() req: WmsRequest) {
    return this.success(req, await this.wmsService.listInventorySnapshots(req.context, query));
  }

  @HttpCode(200)
  @Post("inventory/snapshots/generate")
  async generateInventorySnapshots(@Body() body: unknown, @Req() req: WmsRequest) {
    return this.success(req, await this.wmsService.generateInventorySnapshots(req.context, body));
  }

  @HttpCode(201)
  @Post("inventory/adjustments")
  async adjustInventory(@Body() body: unknown, @Req() req: WmsRequest) {
    return this.success(req, await this.wmsService.adjustInventory(req.context, body));
  }

  @HttpCode(201)
  @Post("inbound/confirmations")
  async confirmInbound(@Body() body: unknown, @Req() req: WmsRequest) {
    return this.success(req, await this.wmsService.confirmInbound(req.context, body));
  }

  @HttpCode(201)
  @Post("outbound/allocations")
  async allocateOutbound(@Body() body: unknown, @Req() req: WmsRequest) {
    return this.success(req, await this.wmsService.allocateOutbound(req.context, body));
  }

  @Get("outbound/packings")
  async listOutboundPackings(@Query() query: Record<string, unknown>, @Req() req: WmsRequest) {
    return this.success(req, await this.wmsService.listOutboundPackings(req.context, query));
  }

  @HttpCode(201)
  @Post("outbound/packings")
  async createOutboundPacking(@Body() body: unknown, @Req() req: WmsRequest) {
    return this.success(req, await this.wmsService.createOutboundPacking(req.context, body));
  }

  @HttpCode(201)
  @Post("outbound/packings/:packingId/packages")
  async addOutboundPackage(@Param("packingId") packingId: string, @Body() body: unknown, @Req() req: WmsRequest) {
    return this.success(req, await this.wmsService.addOutboundPackage(req.context, packingId, body));
  }

  @HttpCode(200)
  @Post("outbound/packings/:packingId/confirm")
  async confirmOutboundPacking(@Param("packingId") packingId: string, @Req() req: WmsRequest) {
    return this.success(req, await this.wmsService.confirmOutboundPacking(req.context, packingId));
  }

  @HttpCode(200)
  @Post("outbound/shipments")
  async shipOutbound(@Body() body: unknown, @Req() req: WmsRequest) {
    return this.success(req, await this.wmsService.shipOutbound(req.context, body));
  }

  private success(req: WmsRequest, data: unknown) {
    return {
      success: true,
      requestId: req.context.requestId,
      timestamp: new Date().toISOString(),
      data
    };
  }
}

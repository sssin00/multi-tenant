import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException
} from "@nestjs/common";

import { Prisma, type InventoryBalance } from "../generated/prisma/client.js";
import {
  InventoryLedgerMovementType,
  InventoryLedgerSourceType,
  InventorySnapshotRunMode,
  InventorySnapshotRunStatus,
  LocationType,
  OutboundAllocationStatus,
  OutboundOrderStatus,
  OutboundPackingStatus
} from "../generated/prisma/enums.js";
import { PrismaService } from "../database/prisma.service.js";
import { AuthIamInternalClient } from "../internal-clients/auth-iam-internal.client.js";
import { TenantInternalClient } from "../internal-clients/tenant-internal.client.js";
import { OutboxEventService } from "../outbox/outbox-event.service.js";
import type {
  InboundReceiptResponse,
  InventoryAdjustmentResponse,
  InventoryBalanceResponse,
  InventoryDailySnapshotResponse,
  InventorySnapshotRunResponse,
  ItemResponse,
  LocationResponse,
  OutboundAllocationResponse,
  OutboundPackageResponse,
  OutboundPackingResponse,
  OutboundShipmentResponse,
  PageResponse,
  WarehouseResponse
} from "./wms-types.js";
import {
  asRecord,
  type CommandContext,
  readCode,
  readDecimal,
  readOptionalString,
  readOptionalUuid,
  readPage,
  readPositiveDecimal,
  readRequiredString,
  readSize,
  requireTenant,
  requireUser,
  requireUuid,
  validationFailed
} from "./wms-utils.js";

const WMS_MODULE_CODE = "wms";
const SEOUL_UTC_OFFSET_MS = 9 * 60 * 60 * 1000;

interface SnapshotSourceRow {
  ledgerId: string;
  warehouseId: string;
  locationId: string;
  itemId: string;
  quantity: string;
  allocatedQuantity: string;
}

interface InventoryMovementCommand {
  movementType: InventoryLedgerMovementType;
  sourceType: InventoryLedgerSourceType;
  sourceId?: string;
  quantityChange: number;
  allocatedQuantityChange: number;
  effectiveDate: Date;
  requestId?: string;
  correctedLedgerId?: string;
  correctionReason?: string;
}

@Injectable()
export class WmsService {
  constructor(
    @Inject(PrismaService)
    private readonly prismaService: PrismaService,
    @Inject(OutboxEventService)
    private readonly outboxEventService: OutboxEventService,
    @Inject(AuthIamInternalClient)
    private readonly authIamInternalClient: AuthIamInternalClient,
    @Inject(TenantInternalClient)
    private readonly tenantInternalClient: TenantInternalClient
  ) {}

  async listWarehouses(context: CommandContext, query: Record<string, unknown>): Promise<PageResponse<WarehouseResponse>> {
    const tenantId = await this.authorize(context, "wms.warehouses.manage");
    const page = readPage(query.page);
    const size = readSize(query.size);
    const code = readOptionalString(query.code)?.toLowerCase();
    const where = {
      tenantId,
      ...(code ? { code: { contains: code } } : {})
    };
    const [items, total] = await Promise.all([
      this.prismaService.warehouse.findMany({
        where,
        orderBy: {
          code: "asc"
        },
        skip: (page - 1) * size,
        take: size
      }),
      this.prismaService.warehouse.count({
        where
      })
    ]);

    return {
      items: items.map((warehouse) => this.toWarehouseResponse(warehouse)),
      page,
      size,
      total
    };
  }

  async createWarehouse(context: CommandContext, body: unknown): Promise<WarehouseResponse> {
    const tenantId = await this.authorize(context, "wms.warehouses.manage");
    const input = this.validateWarehouseBody(body);
    const existing = await this.prismaService.warehouse.findUnique({
      where: {
        tenantId_code: {
          tenantId,
          code: input.code
        }
      },
      select: {
        id: true
      }
    });

    if (existing) {
      throw new ConflictException({
        code: "WMS_WAREHOUSE_CODE_CONFLICT",
        message: "Warehouse code already exists"
      });
    }

    const warehouse = await this.prismaService.warehouse.create({
      data: {
        tenantId,
        code: input.code,
        name: input.name
      }
    });

    return this.toWarehouseResponse(warehouse);
  }

  async listLocations(context: CommandContext, query: Record<string, unknown>): Promise<PageResponse<LocationResponse>> {
    const warehouseId = readOptionalUuid(query.warehouseId, "warehouseId");
    const tenantId = await this.authorize(context, "wms.locations.manage", warehouseId);
    const page = readPage(query.page);
    const size = readSize(query.size);
    const where = {
      tenantId,
      ...(warehouseId ? { warehouseId } : {})
    };
    const [items, total] = await Promise.all([
      this.prismaService.location.findMany({
        where,
        orderBy: [
          {
            warehouseId: "asc"
          },
          {
            code: "asc"
          }
        ],
        skip: (page - 1) * size,
        take: size
      }),
      this.prismaService.location.count({
        where
      })
    ]);

    return {
      items: items.map((location) => this.toLocationResponse(location)),
      page,
      size,
      total
    };
  }

  async createLocation(context: CommandContext, body: unknown): Promise<LocationResponse> {
    const input = this.validateLocationBody(body);
    const tenantId = await this.authorize(context, "wms.locations.manage", input.warehouseId);
    await this.ensureWarehouse(tenantId, input.warehouseId);
    const existing = await this.prismaService.location.findUnique({
      where: {
        tenantId_warehouseId_code: {
          tenantId,
          warehouseId: input.warehouseId,
          code: input.code
        }
      },
      select: {
        id: true
      }
    });

    if (existing) {
      throw new ConflictException({
        code: "WMS_LOCATION_CODE_CONFLICT",
        message: "Location code already exists in warehouse"
      });
    }

    const location = await this.prismaService.location.create({
      data: {
        tenantId,
        warehouseId: input.warehouseId,
        code: input.code,
        name: input.name,
        type: input.type
      }
    });

    return this.toLocationResponse(location);
  }

  async listItems(context: CommandContext, query: Record<string, unknown>): Promise<PageResponse<ItemResponse>> {
    const tenantId = await this.authorize(context, "wms.items.manage");
    const page = readPage(query.page);
    const size = readSize(query.size);
    const sku = readOptionalString(query.sku)?.toLowerCase();
    const where = {
      tenantId,
      ...(sku ? { sku: { contains: sku } } : {})
    };
    const [items, total] = await Promise.all([
      this.prismaService.item.findMany({
        where,
        orderBy: {
          sku: "asc"
        },
        skip: (page - 1) * size,
        take: size
      }),
      this.prismaService.item.count({
        where
      })
    ]);

    return {
      items: items.map((item) => this.toItemResponse(item)),
      page,
      size,
      total
    };
  }

  async createItem(context: CommandContext, body: unknown): Promise<ItemResponse> {
    const tenantId = await this.authorize(context, "wms.items.manage");
    const input = this.validateItemBody(body);
    const existing = await this.prismaService.item.findUnique({
      where: {
        tenantId_sku: {
          tenantId,
          sku: input.sku
        }
      },
      select: {
        id: true
      }
    });

    if (existing) {
      throw new ConflictException({
        code: "WMS_ITEM_SKU_CONFLICT",
        message: "Item SKU already exists"
      });
    }

    const item = await this.prismaService.item.create({
      data: {
        tenantId,
        sku: input.sku,
        name: input.name,
        uom: input.uom
      }
    });

    return this.toItemResponse(item);
  }

  async listInventory(context: CommandContext, query: Record<string, unknown>): Promise<PageResponse<InventoryBalanceResponse>> {
    const warehouseId = readOptionalUuid(query.warehouseId, "warehouseId");
    const locationId = readOptionalUuid(query.locationId, "locationId");
    const itemId = readOptionalUuid(query.itemId, "itemId");
    const tenantId = await this.authorize(context, "wms.inventory.read", warehouseId);
    const page = readPage(query.page);
    const size = readSize(query.size);
    const where = {
      tenantId,
      ...(warehouseId ? { warehouseId } : {}),
      ...(locationId ? { locationId } : {}),
      ...(itemId ? { itemId } : {})
    };
    const [items, total] = await Promise.all([
      this.prismaService.inventoryBalance.findMany({
        where,
        orderBy: [
          {
            warehouseId: "asc"
          },
          {
            locationId: "asc"
          },
          {
            itemId: "asc"
          }
        ],
        skip: (page - 1) * size,
        take: size
      }),
      this.prismaService.inventoryBalance.count({
        where
      })
    ]);

    return {
      items: items.map((balance) => this.toInventoryBalanceResponse(balance)),
      page,
      size,
      total
    };
  }

  async listInventorySnapshots(
    context: CommandContext,
    query: Record<string, unknown>
  ): Promise<PageResponse<InventoryDailySnapshotResponse>> {
    const snapshotDate = this.readRequiredBusinessDate(query.snapshotDate, "snapshotDate");
    const warehouseId = readOptionalUuid(query.warehouseId, "warehouseId");
    const locationId = readOptionalUuid(query.locationId, "locationId");
    const itemId = readOptionalUuid(query.itemId, "itemId");
    const tenantId = await this.authorize(context, "wms.inventory.read", warehouseId);
    const page = readPage(query.page);
    const size = readSize(query.size);
    const where = {
      tenantId,
      snapshotDate: snapshotDate.date,
      isCurrent: true,
      ...(warehouseId ? { warehouseId } : {}),
      ...(locationId ? { locationId } : {}),
      ...(itemId ? { itemId } : {})
    };
    const hasCompletedRun = await this.prismaService.inventorySnapshotRun.findFirst({
      where: {
        tenantId,
        snapshotDate: snapshotDate.date,
        status: InventorySnapshotRunStatus.completed,
        ...(warehouseId ? { warehouseId } : {})
      },
      select: {
        id: true
      }
    });
    if (!hasCompletedRun) {
      throw new NotFoundException({
        code: "WMS_SNAPSHOT_NOT_READY",
        message: "Inventory snapshot is not generated for the requested date"
      });
    }

    const [items, total] = await Promise.all([
      this.prismaService.inventoryDailySnapshot.findMany({
        where,
        orderBy: [
          {
            warehouseId: "asc"
          },
          {
            locationId: "asc"
          },
          {
            itemId: "asc"
          }
        ],
        skip: (page - 1) * size,
        take: size
      }),
      this.prismaService.inventoryDailySnapshot.count({
        where
      })
    ]);

    return {
      items: items.map((snapshot) => this.toInventoryDailySnapshotResponse(snapshot)),
      page,
      size,
      total
    };
  }

  async generateInventorySnapshots(context: CommandContext, body: unknown): Promise<InventorySnapshotRunResponse> {
    const input = this.validateInventorySnapshotGenerateBody(body);
    const tenantId = await this.authorize(context, "wms.inventory.snapshot.generate", input.warehouseId);
    if (input.warehouseId) {
      await this.ensureWarehouse(tenantId, input.warehouseId);
    }

    const run = await this.prismaService.$transaction(async (tx) => {
      const running = await tx.inventorySnapshotRun.findFirst({
        where: {
          tenantId,
          snapshotDate: input.snapshotDate.date,
          warehouseId: input.warehouseId ?? null,
          status: InventorySnapshotRunStatus.running
        },
        select: {
          id: true
        }
      });
      if (running) {
        throw new ConflictException({
          code: "WMS_SNAPSHOT_REBUILD_CONFLICT",
          message: "Inventory snapshot generation is already running for the requested tenant and date"
        });
      }

      const createdRun = await tx.inventorySnapshotRun.create({
        data: {
          tenantId,
          snapshotDate: input.snapshotDate.date,
          snapshotAt: input.snapshotDate.snapshotAt,
          warehouseId: input.warehouseId,
          mode: input.mode,
          createdBy: context.userId,
          requestId: context.requestId ?? "unknown"
        }
      });
      const sourceRows = await this.findSnapshotSourceRows(tx, tenantId, input.snapshotDate.text, input.warehouseId);
      const existingSnapshots = await tx.inventoryDailySnapshot.findMany({
        where: {
          tenantId,
          snapshotDate: input.snapshotDate.date,
          isCurrent: true,
          ...(input.warehouseId ? { warehouseId: input.warehouseId } : {})
        }
      });
      const existingByKey = new Map(existingSnapshots.map((snapshot) => [this.snapshotKey(snapshot), snapshot]));
      let generatedCount = 0;
      let unchangedCount = 0;

      for (const source of sourceRows) {
        const quantity = this.roundQuantity(Number(source.quantity));
        const allocatedQuantity = this.roundQuantity(Number(source.allocatedQuantity));
        const availableQuantity = this.roundQuantity(quantity - allocatedQuantity);
        const key = this.snapshotKey(source);
        const existing = existingByKey.get(key);
        const isUnchanged =
          existing &&
          this.decimalToNumber(existing.quantity) === quantity &&
          this.decimalToNumber(existing.allocatedQuantity) === allocatedQuantity &&
          existing.sourceLedgerId === source.ledgerId;

        if (isUnchanged) {
          unchangedCount += 1;
          continue;
        }

        if (existing) {
          await tx.inventoryDailySnapshot.update({
            where: {
              id: existing.id
            },
            data: {
              isCurrent: false
            }
          });
        }

        await tx.inventoryDailySnapshot.create({
          data: {
            tenantId,
            snapshotDate: input.snapshotDate.date,
            snapshotAt: input.snapshotDate.snapshotAt,
            warehouseId: source.warehouseId,
            locationId: source.locationId,
            itemId: source.itemId,
            quantity,
            allocatedQuantity,
            availableQuantity,
            sourceLedgerId: source.ledgerId,
            runId: createdRun.id,
            previousSnapshotId: existing?.id
          }
        });
        generatedCount += 1;
      }

      const completedRun = await tx.inventorySnapshotRun.update({
        where: {
          id: createdRun.id
        },
        data: {
          status: InventorySnapshotRunStatus.completed,
          generatedCount,
          unchangedCount,
          finishedAt: new Date()
        }
      });
      await this.outboxEventService.record(tx, {
        context: {
          tenantId,
          userId: context.userId,
          requestId: context.requestId
        },
        eventType: "wms.inventory.snapshot.generated",
        aggregateType: "inventory_snapshot_run",
        aggregateId: completedRun.id,
        data: {
          runId: completedRun.id,
          snapshotDate: input.snapshotDate.text,
          snapshotAt: input.snapshotDate.snapshotAt.toISOString(),
          warehouseId: input.warehouseId ?? null,
          mode: input.mode,
          generatedCount,
          unchangedCount,
          sourceLedgerCount: sourceRows.length
        }
      });

      return completedRun;
    });

    return this.toInventorySnapshotRunResponse(run);
  }

  async adjustInventory(context: CommandContext, body: unknown): Promise<InventoryAdjustmentResponse> {
    const input = this.validateInventoryAdjustmentBody(body);
    const tenantId = await this.authorize(context, "wms.inventory.adjust", input.warehouseId);

    const adjustment = await this.prismaService.$transaction(async (tx) => {
      await this.ensureStockReferences(tx, tenantId, input.warehouseId, input.locationId, input.itemId);
      const createdAdjustment = await tx.inventoryAdjustment.create({
        data: {
          tenantId,
          warehouseId: input.warehouseId,
          locationId: input.locationId,
          itemId: input.itemId,
          quantityChange: input.quantityChange,
          reason: input.reason,
          referenceNo: input.referenceNo,
          memo: input.memo,
          adjustedBy: context.userId,
          effectiveDate: input.effectiveDate,
          correctedLedgerId: input.correctedLedgerId,
          correctionReason: input.correctionReason
        }
      });
      await this.applyQuantityChange(tx, tenantId, input.warehouseId, input.locationId, input.itemId, {
        quantityChange: input.quantityChange,
        movementType: input.isCorrection ? InventoryLedgerMovementType.correction : InventoryLedgerMovementType.adjustment,
        sourceType: InventoryLedgerSourceType.inventory_adjustment,
        sourceId: createdAdjustment.id,
        effectiveDate: input.effectiveDate,
        requestId: context.requestId,
        correctedLedgerId: input.correctedLedgerId,
        correctionReason: input.correctionReason
      });
      await this.outboxEventService.record(tx, {
        context: {
          tenantId,
          userId: context.userId,
          requestId: context.requestId
        },
        eventType: "wms.inventory.adjusted",
        aggregateType: "inventory_adjustment",
        aggregateId: createdAdjustment.id,
        data: {
          adjustmentId: createdAdjustment.id,
          warehouseId: input.warehouseId,
          locationId: input.locationId,
          itemId: input.itemId,
          quantityChange: input.quantityChange.toFixed(3),
          reason: input.reason,
          referenceNo: input.referenceNo ?? null,
          effectiveDate: this.formatBusinessDate(input.effectiveDate),
          correctedLedgerId: input.correctedLedgerId ?? null,
          correctionReason: input.correctionReason ?? null
        }
      });

      return createdAdjustment;
    });

    return this.toInventoryAdjustmentResponse(adjustment);
  }

  async confirmInbound(context: CommandContext, body: unknown): Promise<InboundReceiptResponse> {
    const input = this.validateInboundConfirmationBody(body);
    const tenantId = await this.authorize(context, "wms.inbound.confirm", input.warehouseId);

    const receipt = await this.prismaService.$transaction(async (tx) => {
      await this.ensureStockReferences(tx, tenantId, input.warehouseId, input.locationId, input.itemId);
      const confirmedAt = new Date();
      const createdReceipt = await tx.inboundReceipt.create({
        data: {
          tenantId,
          warehouseId: input.warehouseId,
          locationId: input.locationId,
          itemId: input.itemId,
          quantity: input.quantity,
          referenceNo: input.referenceNo,
          confirmedBy: context.userId,
          confirmedAt
        }
      });
      await this.applyQuantityChange(tx, tenantId, input.warehouseId, input.locationId, input.itemId, {
        quantityChange: input.quantity,
        movementType: InventoryLedgerMovementType.inbound,
        sourceType: InventoryLedgerSourceType.inbound_receipt,
        sourceId: createdReceipt.id,
        effectiveDate: this.businessDateFromDate(confirmedAt),
        requestId: context.requestId
      });
      await this.outboxEventService.record(tx, {
        context: {
          tenantId,
          userId: context.userId,
          requestId: context.requestId
        },
        eventType: "wms.inbound.confirmed",
        aggregateType: "inbound_receipt",
        aggregateId: createdReceipt.id,
        data: {
          receiptId: createdReceipt.id,
          warehouseId: input.warehouseId,
          locationId: input.locationId,
          itemId: input.itemId,
          quantity: input.quantity.toFixed(3),
          referenceNo: input.referenceNo ?? null
        }
      });

      return createdReceipt;
    });

    return this.toInboundReceiptResponse(receipt);
  }

  async allocateOutbound(context: CommandContext, body: unknown): Promise<OutboundAllocationResponse> {
    const input = this.validateOutboundAllocationBody(body);
    const tenantId = await this.authorize(context, "wms.outbound.allocate", input.warehouseId);

    const allocation = await this.prismaService.$transaction(async (tx) => {
      await this.ensureStockReferences(tx, tenantId, input.warehouseId, input.locationId, input.itemId);
      const order = await this.findOrCreateOutboundOrder(tx, tenantId, input.warehouseId, input.orderNo);
      const createdAllocation = await tx.outboundAllocation.create({
        data: {
          tenantId,
          outboundOrderId: order.id,
          warehouseId: input.warehouseId,
          locationId: input.locationId,
          itemId: input.itemId,
          quantity: input.quantity,
          allocatedBy: context.userId
        },
        include: {
          outboundOrder: true
        }
      });
      await this.applyAllocation(tx, tenantId, input.warehouseId, input.locationId, input.itemId, input.quantity, {
        movementType: InventoryLedgerMovementType.allocation,
        sourceType: InventoryLedgerSourceType.outbound_allocation,
        sourceId: createdAllocation.id,
        effectiveDate: this.businessDateFromDate(createdAllocation.allocatedAt),
        requestId: context.requestId
      });
      await tx.outboundOrder.update({
        where: {
          id: order.id
        },
        data: {
          status: OutboundOrderStatus.allocated
        }
      });
      await this.outboxEventService.record(tx, {
        context: {
          tenantId,
          userId: context.userId,
          requestId: context.requestId
        },
        eventType: "wms.outbound.allocated",
        aggregateType: "outbound_allocation",
        aggregateId: createdAllocation.id,
        data: {
          allocationId: createdAllocation.id,
          outboundOrderId: order.id,
          orderNo: order.orderNo,
          warehouseId: input.warehouseId,
          locationId: input.locationId,
          itemId: input.itemId,
          quantity: input.quantity.toFixed(3)
        }
      });

      return createdAllocation;
    });

    return this.toOutboundAllocationResponse(allocation);
  }

  async listOutboundAllocations(
    context: CommandContext,
    query: Record<string, unknown>
  ): Promise<PageResponse<OutboundAllocationResponse>> {
    const warehouseId = readOptionalUuid(query.warehouseId, "warehouseId");
    const outboundOrderId = readOptionalUuid(query.outboundOrderId, "outboundOrderId");
    const statusText = readOptionalString(query.status);
    let status: OutboundAllocationStatus | undefined;
    if (statusText) {
      if (!this.isOutboundAllocationStatus(statusText)) {
        throw validationFailed({
          status: "status must be one of allocated, shipped, cancelled"
        });
      }
      status = statusText;
    }

    const tenantId = await this.authorize(context, "wms.outbound.allocate", warehouseId);
    const page = readPage(query.page);
    const size = readSize(query.size);
    const where = {
      tenantId,
      ...(warehouseId ? { warehouseId } : {}),
      ...(outboundOrderId ? { outboundOrderId } : {}),
      ...(status ? { status } : {})
    };
    const [items, total] = await Promise.all([
      this.prismaService.outboundAllocation.findMany({
        where,
        include: {
          outboundOrder: true
        },
        orderBy: {
          allocatedAt: "desc"
        },
        skip: (page - 1) * size,
        take: size
      }),
      this.prismaService.outboundAllocation.count({
        where
      })
    ]);

    return {
      items: items.map((allocation) => this.toOutboundAllocationResponse(allocation)),
      page,
      size,
      total
    };
  }

  async listOutboundPackings(context: CommandContext, query: Record<string, unknown>): Promise<PageResponse<OutboundPackingResponse>> {
    const warehouseId = readOptionalUuid(query.warehouseId, "warehouseId");
    const outboundOrderId = readOptionalUuid(query.outboundOrderId, "outboundOrderId");
    const statusText = readOptionalString(query.status);
    let status: OutboundPackingStatus | undefined;
    if (statusText) {
      if (!this.isOutboundPackingStatus(statusText)) {
        throw validationFailed({
          status: "status must be one of packing, confirmed, shipped, cancelled"
        });
      }
      status = statusText;
    }

    const tenantId = await this.authorize(context, "wms.outbound.pack", warehouseId);
    const page = readPage(query.page);
    const size = readSize(query.size);
    const where = {
      tenantId,
      ...(warehouseId ? { warehouseId } : {}),
      ...(outboundOrderId ? { outboundOrderId } : {}),
      ...(status ? { status } : {})
    };
    const [items, total] = await Promise.all([
      this.prismaService.outboundPacking.findMany({
        where,
        include: {
          outboundOrder: true,
          allocations: {
            select: {
              allocationId: true
            }
          },
          packages: {
            select: {
              id: true
            }
          }
        },
        orderBy: {
          createdAt: "desc"
        },
        skip: (page - 1) * size,
        take: size
      }),
      this.prismaService.outboundPacking.count({
        where
      })
    ]);

    return {
      items: items.map((packing) => this.toOutboundPackingResponse(packing)),
      page,
      size,
      total
    };
  }

  async createOutboundPacking(context: CommandContext, body: unknown): Promise<OutboundPackingResponse> {
    const input = this.validateOutboundPackingBody(body);
    const requestedTenantId = requireTenant(context.tenantId);
    const allocationsForScope = await this.prismaService.outboundAllocation.findMany({
      where: {
        id: {
          in: input.allocationIds
        },
        tenantId: requestedTenantId
      },
      include: {
        outboundOrder: true
      }
    });
    const scope = this.assertPackableAllocations(allocationsForScope, input.allocationIds, input.outboundOrderId);
    const tenantId = await this.authorize(context, "wms.outbound.pack", scope.warehouseId);

    const packing = await this.prismaService.$transaction(async (tx) => {
      const allocations = await tx.outboundAllocation.findMany({
        where: {
          id: {
            in: input.allocationIds
          },
          tenantId
        },
        include: {
          outboundOrder: true
        }
      });
      const packingScope = this.assertPackableAllocations(allocations, input.allocationIds, input.outboundOrderId);
      const existingPackedAllocation = await tx.outboundPackingAllocation.findFirst({
        where: {
          tenantId,
          allocationId: {
            in: input.allocationIds
          },
          packing: {
            status: {
              not: OutboundPackingStatus.cancelled
            }
          }
        },
        select: {
          allocationId: true
        }
      });
      if (existingPackedAllocation) {
        throw new ConflictException({
          code: "WMS_PACKING_ALLOCATION_ALREADY_PACKED",
          message: "Outbound allocation is already assigned to a packing"
        });
      }

      return tx.outboundPacking.create({
        data: {
          tenantId,
          outboundOrderId: packingScope.outboundOrderId,
          warehouseId: packingScope.warehouseId,
          memo: input.memo,
          packedBy: context.userId,
          allocations: {
            create: input.allocationIds.map((allocationId) => ({
              tenantId,
              allocationId
            }))
          }
        },
        include: {
          outboundOrder: true,
          allocations: {
            select: {
              allocationId: true
            }
          },
          packages: {
            select: {
              id: true
            }
          }
        }
      });
    });

    return this.toOutboundPackingResponse(packing);
  }

  async addOutboundPackage(context: CommandContext, packingIdValue: string, body: unknown): Promise<OutboundPackageResponse> {
    const packingId = requireUuid(packingIdValue, "packingId");
    const input = this.validateOutboundPackageBody(body);
    const requestedTenantId = requireTenant(context.tenantId);
    const packingForScope = await this.prismaService.outboundPacking.findFirst({
      where: {
        id: packingId,
        tenantId: requestedTenantId
      },
      select: {
        warehouseId: true
      }
    });
    if (!packingForScope) {
      throw new NotFoundException({
        code: "WMS_PACKING_NOT_FOUND",
        message: "Outbound packing not found"
      });
    }

    const tenantId = await this.authorize(context, "wms.outbound.pack", packingForScope.warehouseId);
    const outboundPackage = await this.prismaService.$transaction(async (tx) => {
      const packing = await tx.outboundPacking.findFirst({
        where: {
          id: packingId,
          tenantId
        },
        include: {
          allocations: {
            include: {
              allocation: true
            }
          }
        }
      });
      if (!packing) {
        throw new NotFoundException({
          code: "WMS_PACKING_NOT_FOUND",
          message: "Outbound packing not found"
        });
      }
      if (packing.status !== OutboundPackingStatus.packing) {
        throw new ConflictException({
          code: "WMS_PACKING_ALREADY_CONFIRMED",
          message: "Outbound packing cannot be changed after confirmation"
        });
      }

      const existingPackage = await tx.outboundPackage.findUnique({
        where: {
          tenantId_packingId_packageNo: {
            tenantId,
            packingId,
            packageNo: input.packageNo
          }
        },
        select: {
          id: true
        }
      });
      if (existingPackage) {
        throw new ConflictException({
          code: "WMS_PACKAGE_NO_CONFLICT",
          message: "Package number already exists in packing"
        });
      }

      const allocationMap = new Map(packing.allocations.map((link) => [link.allocationId, link.allocation]));
      for (const item of input.items) {
        const allocation = allocationMap.get(item.allocationId);
        if (!allocation || allocation.itemId !== item.itemId) {
          throw validationFailed(
            {
              items: "package items must reference allocations in the packing and matching itemIds"
            },
            "WMS_PACKING_ALLOCATION_MISMATCH",
            "Package item does not match packing allocation"
          );
        }
      }

      return tx.outboundPackage.create({
        data: {
          tenantId,
          packingId,
          packageNo: input.packageNo,
          boxType: input.boxType,
          weight: input.weight,
          width: input.width,
          height: input.height,
          depth: input.depth,
          items: {
            create: input.items.map((item) => ({
              tenantId,
              allocationId: item.allocationId,
              itemId: item.itemId,
              quantity: item.quantity
            }))
          }
        },
        include: {
          items: true
        }
      });
    });

    return this.toOutboundPackageResponse(outboundPackage);
  }

  async confirmOutboundPacking(context: CommandContext, packingIdValue: string): Promise<OutboundPackingResponse> {
    const packingId = requireUuid(packingIdValue, "packingId");
    const requestedTenantId = requireTenant(context.tenantId);
    const packingForScope = await this.prismaService.outboundPacking.findFirst({
      where: {
        id: packingId,
        tenantId: requestedTenantId
      },
      select: {
        warehouseId: true
      }
    });
    if (!packingForScope) {
      throw new NotFoundException({
        code: "WMS_PACKING_NOT_FOUND",
        message: "Outbound packing not found"
      });
    }

    const tenantId = await this.authorize(context, "wms.outbound.pack", packingForScope.warehouseId);
    const confirmedPacking = await this.prismaService.$transaction(async (tx) => {
      const packing = await tx.outboundPacking.findFirst({
        where: {
          id: packingId,
          tenantId
        },
        include: {
          outboundOrder: true,
          allocations: {
            include: {
              allocation: true
            }
          },
          packages: {
            include: {
              items: true
            }
          }
        }
      });
      if (!packing) {
        throw new NotFoundException({
          code: "WMS_PACKING_NOT_FOUND",
          message: "Outbound packing not found"
        });
      }
      if (packing.status !== OutboundPackingStatus.packing) {
        throw new ConflictException({
          code: "WMS_PACKING_ALREADY_CONFIRMED",
          message: "Outbound packing is already confirmed"
        });
      }

      this.assertPackingQuantitiesMatch(packing);
      const confirmedAt = new Date();
      const updatedPacking = await tx.outboundPacking.update({
        where: {
          id: packing.id
        },
        data: {
          status: OutboundPackingStatus.confirmed,
          confirmedBy: context.userId,
          confirmedAt
        },
        include: {
          outboundOrder: true,
          allocations: {
            select: {
              allocationId: true
            }
          },
          packages: {
            select: {
              id: true
            }
          }
        }
      });
      await this.outboxEventService.record(tx, {
        context: {
          tenantId,
          userId: context.userId,
          requestId: context.requestId
        },
        eventType: "wms.outbound.packed",
        aggregateType: "outbound_packing",
        aggregateId: updatedPacking.id,
        data: {
          packingId: updatedPacking.id,
          outboundOrderId: updatedPacking.outboundOrderId,
          orderNo: updatedPacking.outboundOrder.orderNo,
          allocationIds: updatedPacking.allocations.map((allocation) => allocation.allocationId),
          packageIds: updatedPacking.packages.map((outboundPackage) => outboundPackage.id),
          packageCount: updatedPacking.packages.length,
          totalQuantity: this.totalPackedQuantity(packing).toFixed(3),
          confirmedAt: confirmedAt.toISOString()
        }
      });

      return updatedPacking;
    });

    return this.toOutboundPackingResponse(confirmedPacking);
  }

  async shipOutbound(context: CommandContext, body: unknown): Promise<OutboundAllocationResponse | OutboundShipmentResponse> {
    const input = this.validateOutboundShipmentBody(body);
    if (input.packingId) {
      return this.shipOutboundPacking(context, {
        ...input,
        packingId: input.packingId
      });
    }
    if (!input.allocationId) {
      throw validationFailed({
        allocationId: "allocationId is required when packingId is not provided"
      });
    }

    return this.shipOutboundAllocation(context, {
      ...input,
      allocationId: input.allocationId
    });
  }

  private async shipOutboundAllocation(
    context: CommandContext,
    input: {
      allocationId: string;
      carrierCode?: string;
      trackingNo?: string;
      shippedAt?: Date;
    }
  ): Promise<OutboundAllocationResponse> {
    const requestedTenantId = requireTenant(context.tenantId);
    const allocationForScope = await this.prismaService.outboundAllocation.findFirst({
      where: {
        id: input.allocationId,
        tenantId: requestedTenantId
      },
      select: {
        warehouseId: true
      }
    });
    if (!allocationForScope) {
      throw new NotFoundException({
        code: "WMS_OUTBOUND_ALLOCATION_NOT_FOUND",
        message: "Outbound allocation not found"
      });
    }
    const tenantId = await this.authorize(context, "wms.outbound.ship", allocationForScope.warehouseId);

    const allocation = await this.prismaService.$transaction(async (tx) => {
      const currentAllocation = await tx.outboundAllocation.findFirst({
        where: {
          id: input.allocationId,
          tenantId
        },
        include: {
          outboundOrder: true
        }
      });
      if (!currentAllocation) {
        throw new NotFoundException({
          code: "WMS_OUTBOUND_ALLOCATION_NOT_FOUND",
          message: "Outbound allocation not found"
        });
      }
      if (currentAllocation.status !== OutboundAllocationStatus.allocated) {
        throw new ConflictException({
          code: "WMS_OUTBOUND_ALLOCATION_NOT_ALLOCATED",
          message: "Outbound allocation is not allocated"
        });
      }

      const shippedAt = input.shippedAt ?? new Date();
      const createdShipment = await tx.outboundShipment.create({
        data: {
          tenantId,
          allocationId: currentAllocation.id,
          outboundOrderId: currentAllocation.outboundOrderId,
          warehouseId: currentAllocation.warehouseId,
          carrierCode: input.carrierCode,
          trackingNo: input.trackingNo,
          shippedBy: context.userId,
          shippedAt
        }
      });
      await this.applyShipment(
        tx,
        tenantId,
        currentAllocation.warehouseId,
        currentAllocation.locationId,
        currentAllocation.itemId,
        this.decimalToNumber(currentAllocation.quantity),
        {
          movementType: InventoryLedgerMovementType.shipment,
          sourceType: InventoryLedgerSourceType.outbound_shipment,
          sourceId: createdShipment.id,
          effectiveDate: this.businessDateFromDate(shippedAt),
          requestId: context.requestId
        }
      );
      const shippedAllocation = await tx.outboundAllocation.update({
        where: {
          id: currentAllocation.id
        },
        data: {
          status: OutboundAllocationStatus.shipped,
          shippedBy: context.userId,
          shippedAt
        },
        include: {
          outboundOrder: true
        }
      });
      await this.refreshOutboundOrderStatus(tx, tenantId, currentAllocation.outboundOrderId, shippedAt);
      await this.outboxEventService.record(tx, {
        context: {
          tenantId,
          userId: context.userId,
          requestId: context.requestId
        },
        eventType: "wms.outbound.shipped",
        aggregateType: "outbound_allocation",
        aggregateId: shippedAllocation.id,
        data: {
          allocationId: shippedAllocation.id,
          outboundOrderId: shippedAllocation.outboundOrderId,
          orderNo: shippedAllocation.outboundOrder.orderNo,
          warehouseId: shippedAllocation.warehouseId,
          locationId: shippedAllocation.locationId,
          itemId: shippedAllocation.itemId,
          quantity: shippedAllocation.quantity.toString(),
          carrierCode: input.carrierCode ?? null,
          trackingNo: input.trackingNo ?? null,
          shippedAt: shippedAt.toISOString()
        }
      });

      return shippedAllocation;
    });

    return this.toOutboundAllocationResponse(allocation);
  }

  private async shipOutboundPacking(
    context: CommandContext,
    input: {
      packingId: string;
      carrierCode?: string;
      trackingNo?: string;
      shippedAt?: Date;
    }
  ): Promise<OutboundShipmentResponse> {
    const requestedTenantId = requireTenant(context.tenantId);
    const packingForScope = await this.prismaService.outboundPacking.findFirst({
      where: {
        id: input.packingId,
        tenantId: requestedTenantId
      },
      select: {
        warehouseId: true
      }
    });
    if (!packingForScope) {
      throw new NotFoundException({
        code: "WMS_PACKING_NOT_FOUND",
        message: "Outbound packing not found"
      });
    }

    const tenantId = await this.authorize(context, "wms.outbound.ship", packingForScope.warehouseId);
    const shipment = await this.prismaService.$transaction(async (tx) => {
      const packing = await tx.outboundPacking.findFirst({
        where: {
          id: input.packingId,
          tenantId
        },
        include: {
          outboundOrder: true,
          allocations: {
            include: {
              allocation: true
            }
          },
          packages: {
            include: {
              items: true
            }
          }
        }
      });
      if (!packing) {
        throw new NotFoundException({
          code: "WMS_PACKING_NOT_FOUND",
          message: "Outbound packing not found"
        });
      }
      if (packing.status === OutboundPackingStatus.shipped) {
        throw new ConflictException({
          code: "WMS_SHIPMENT_ALREADY_SHIPPED",
          message: "Outbound packing is already shipped"
        });
      }
      if (packing.status !== OutboundPackingStatus.confirmed) {
        throw new UnprocessableEntityException({
          code: "WMS_SHIPMENT_NOT_READY",
          message: "Outbound packing must be confirmed before shipment"
        });
      }

      const shippedAt = input.shippedAt ?? new Date();
      const createdShipment = await tx.outboundShipment.create({
        data: {
          tenantId,
          packingId: packing.id,
          outboundOrderId: packing.outboundOrderId,
          warehouseId: packing.warehouseId,
          carrierCode: input.carrierCode,
          trackingNo: input.trackingNo,
          shippedBy: context.userId,
          shippedAt
        },
        include: {
          outboundOrder: true
        }
      });
      for (const link of packing.allocations) {
        const allocation = link.allocation;
        if (allocation.status !== OutboundAllocationStatus.allocated) {
          throw new ConflictException({
            code: allocation.status === OutboundAllocationStatus.shipped ? "WMS_SHIPMENT_ALREADY_SHIPPED" : "WMS_SHIPMENT_NOT_READY",
            message: "Outbound allocation is not ready for packing shipment"
          });
        }

        await this.applyShipment(
          tx,
          tenantId,
          allocation.warehouseId,
          allocation.locationId,
          allocation.itemId,
          this.decimalToNumber(allocation.quantity),
          {
            movementType: InventoryLedgerMovementType.shipment,
            sourceType: InventoryLedgerSourceType.outbound_shipment,
            sourceId: createdShipment.id,
            effectiveDate: this.businessDateFromDate(shippedAt),
            requestId: context.requestId
          }
        );
        await tx.outboundAllocation.update({
          where: {
            id: allocation.id
          },
          data: {
            status: OutboundAllocationStatus.shipped,
            shippedBy: context.userId,
            shippedAt
          }
        });
      }

      await tx.outboundPacking.update({
        where: {
          id: packing.id
        },
        data: {
          status: OutboundPackingStatus.shipped,
          shippedAt
        }
      });
      await this.refreshOutboundOrderStatus(tx, tenantId, packing.outboundOrderId, shippedAt);
      await this.outboxEventService.record(tx, {
        context: {
          tenantId,
          userId: context.userId,
          requestId: context.requestId
        },
        eventType: "wms.outbound.shipped",
        aggregateType: "outbound_shipment",
        aggregateId: createdShipment.id,
        data: {
          shipmentId: createdShipment.id,
          packingId: packing.id,
          outboundOrderId: packing.outboundOrderId,
          orderNo: packing.outboundOrder.orderNo,
          warehouseId: packing.warehouseId,
          allocationIds: packing.allocations.map((link) => link.allocationId),
          packageIds: packing.packages.map((outboundPackage) => outboundPackage.id),
          packageCount: packing.packages.length,
          totalQuantity: this.totalPackedQuantity(packing).toFixed(3),
          carrierCode: input.carrierCode ?? null,
          trackingNo: input.trackingNo ?? null,
          shippedAt: shippedAt.toISOString()
        }
      });

      return createdShipment;
    });

    return this.toOutboundShipmentResponse(shipment);
  }

  private async authorize(context: CommandContext, permission: string, warehouseId?: string): Promise<string> {
    const tenantId = requireTenant(context.tenantId);
    const userId = requireUser(context.userId);
    await this.ensureTenantWmsEnabled(tenantId, context.requestId, userId);
    const result = await this.authIamInternalClient.checkPermission({
      requestId: context.requestId ?? "unknown",
      tenantId,
      userId,
      permission,
      scope: warehouseId ? { warehouseId } : {}
    });

    if (!result.allowed) {
      throw new ForbiddenException({
        code: "WMS_PERMISSION_DENIED",
        message: "User does not have required WMS permission",
        details: {
          permission,
          warehouseId: warehouseId ?? null
        }
      });
    }

    return tenantId;
  }

  private async ensureTenantWmsEnabled(tenantId: string, requestId?: string, userId?: string) {
    const modules = await this.tenantInternalClient.getTenantModules({
      requestId: requestId ?? "unknown",
      tenantId,
      userId
    });

    if (modules.status !== "active" || !modules.enabledModules.includes(WMS_MODULE_CODE)) {
      throw new ForbiddenException({
        code: "TENANT_NOT_READY",
        message: "Tenant is not active or WMS module is not enabled",
        details: {
          tenantId,
          status: modules.status,
          moduleCode: WMS_MODULE_CODE
        }
      });
    }
  }

  private validateWarehouseBody(body: unknown): { code: string; name: string } {
    const input = asRecord(body);
    return {
      code: readCode(input.code, "code"),
      name: readRequiredString(input.name, "name")
    };
  }

  private validateLocationBody(body: unknown): {
    warehouseId: string;
    code: string;
    name?: string;
    type: LocationType;
  } {
    const input = asRecord(body);
    const type = readOptionalString(input.type) ?? LocationType.storage;
    if (!this.isLocationType(type)) {
      throw validationFailed({
        type: "type must be one of storage, receiving, shipping, staging"
      });
    }

    return {
      warehouseId: requireUuid(readOptionalString(input.warehouseId) ?? "", "warehouseId"),
      code: readCode(input.code, "code"),
      name: readOptionalString(input.name),
      type
    };
  }

  private validateItemBody(body: unknown): { sku: string; name: string; uom: string } {
    const input = asRecord(body);
    return {
      sku: readCode(input.sku, "sku"),
      name: readRequiredString(input.name, "name"),
      uom: readRequiredString(input.uom, "uom", 20).toLowerCase()
    };
  }

  private validateInventoryAdjustmentBody(body: unknown) {
    const input = asRecord(body);
    const effectiveDate = this.readOptionalBusinessDate(input.effectiveDate, "effectiveDate") ?? this.businessDateFromDate(new Date());
    const correctedLedgerId = readOptionalUuid(input.correctedLedgerId, "correctedLedgerId");
    const correctionReason = readOptionalString(input.correctionReason);
    if (correctedLedgerId && !correctionReason) {
      throw validationFailed({
        correctionReason: "correctionReason is required when correctedLedgerId is provided"
      });
    }

    return {
      warehouseId: requireUuid(readOptionalString(input.warehouseId) ?? "", "warehouseId"),
      locationId: requireUuid(readOptionalString(input.locationId) ?? "", "locationId"),
      itemId: requireUuid(readOptionalString(input.itemId) ?? "", "itemId"),
      quantityChange: readDecimal(input.quantityChange, "quantityChange"),
      reason: readRequiredString(input.reason, "reason", 100),
      referenceNo: readOptionalString(input.referenceNo),
      memo: readOptionalString(input.memo),
      effectiveDate,
      correctedLedgerId,
      correctionReason,
      isCorrection: Boolean(correctedLedgerId || correctionReason || this.formatBusinessDate(effectiveDate) !== this.formatBusinessDate(new Date()))
    };
  }

  private validateInventorySnapshotGenerateBody(body: unknown): {
    snapshotDate: {
      text: string;
      date: Date;
      snapshotAt: Date;
    };
    mode: InventorySnapshotRunMode;
    warehouseId?: string;
  } {
    const input = asRecord(body);
    const snapshotDate = this.readRequiredBusinessDate(input.snapshotDate, "snapshotDate");
    const modeText = readOptionalString(input.mode) ?? InventorySnapshotRunMode.generate;
    if (!this.isInventorySnapshotRunMode(modeText)) {
      throw validationFailed({
        mode: "mode must be one of generate, rebuild"
      });
    }

    return {
      snapshotDate,
      mode: modeText,
      warehouseId: readOptionalUuid(input.warehouseId, "warehouseId")
    };
  }

  private validateInboundConfirmationBody(body: unknown) {
    const input = asRecord(body);
    return {
      warehouseId: requireUuid(readOptionalString(input.warehouseId) ?? "", "warehouseId"),
      locationId: requireUuid(readOptionalString(input.locationId) ?? "", "locationId"),
      itemId: requireUuid(readOptionalString(input.itemId) ?? "", "itemId"),
      quantity: readPositiveDecimal(input.quantity, "quantity"),
      referenceNo: readOptionalString(input.referenceNo)
    };
  }

  private validateOutboundAllocationBody(body: unknown) {
    const input = asRecord(body);
    return {
      orderNo: readRequiredString(input.orderNo, "orderNo", 100),
      warehouseId: requireUuid(readOptionalString(input.warehouseId) ?? "", "warehouseId"),
      locationId: requireUuid(readOptionalString(input.locationId) ?? "", "locationId"),
      itemId: requireUuid(readOptionalString(input.itemId) ?? "", "itemId"),
      quantity: readPositiveDecimal(input.quantity, "quantity")
    };
  }

  private validateOutboundPackingBody(body: unknown): {
    outboundOrderId?: string;
    allocationIds: string[];
    memo?: string;
  } {
    const input = asRecord(body);
    const rawAllocationIds = Array.isArray(input.allocationIds) ? input.allocationIds : [];
    const allocationIds = rawAllocationIds.map((allocationId, index) =>
      requireUuid(readOptionalString(allocationId) ?? "", `allocationIds.${index}`)
    );
    if (allocationIds.length === 0) {
      throw validationFailed({
        allocationIds: "allocationIds must include at least one allocationId"
      });
    }
    if (new Set(allocationIds).size !== allocationIds.length) {
      throw validationFailed({
        allocationIds: "allocationIds must not contain duplicates"
      });
    }

    return {
      outboundOrderId: readOptionalUuid(input.outboundOrderId, "outboundOrderId"),
      allocationIds,
      memo: readOptionalString(input.memo)
    };
  }

  private validateOutboundPackageBody(body: unknown): {
    packageNo: string;
    boxType?: string;
    weight?: number;
    width?: number;
    height?: number;
    depth?: number;
    items: Array<{
      allocationId: string;
      itemId: string;
      quantity: number;
    }>;
  } {
    const input = asRecord(body);
    const rawItems = Array.isArray(input.items) ? input.items : [];
    const items = rawItems.map((rawItem, index) => {
      const item = asRecord(rawItem);
      return {
        allocationId: requireUuid(readOptionalString(item.allocationId) ?? "", `items.${index}.allocationId`),
        itemId: requireUuid(readOptionalString(item.itemId) ?? "", `items.${index}.itemId`),
        quantity: readPositiveDecimal(item.quantity, `items.${index}.quantity`)
      };
    });
    if (items.length === 0) {
      throw validationFailed({
        items: "items must include at least one package item"
      });
    }

    return {
      packageNo: readRequiredString(input.packageNo, "packageNo", 100),
      boxType: readOptionalString(input.boxType),
      weight: this.readOptionalPositiveMeasure(input.weight, "weight"),
      width: this.readOptionalPositiveMeasure(input.width, "width"),
      height: this.readOptionalPositiveMeasure(input.height, "height"),
      depth: this.readOptionalPositiveMeasure(input.depth, "depth"),
      items
    };
  }

  private validateOutboundShipmentBody(body: unknown): {
    allocationId?: string;
    packingId?: string;
    carrierCode?: string;
    trackingNo?: string;
    shippedAt?: Date;
  } {
    const input = asRecord(body);
    const allocationId = readOptionalUuid(input.allocationId, "allocationId");
    const packingId = readOptionalUuid(input.packingId, "packingId");
    if (!allocationId && !packingId) {
      throw validationFailed({
        allocationId: "allocationId or packingId is required",
        packingId: "allocationId or packingId is required"
      });
    }
    if (allocationId && packingId) {
      throw validationFailed({
        allocationId: "allocationId and packingId cannot be used together",
        packingId: "allocationId and packingId cannot be used together"
      });
    }

    return {
      allocationId,
      packingId,
      carrierCode: readOptionalString(input.carrierCode),
      trackingNo: readOptionalString(input.trackingNo),
      shippedAt: this.readOptionalDate(input.shippedAt, "shippedAt")
    };
  }

  private isLocationType(value: string): value is LocationType {
    return Object.values(LocationType).includes(value as LocationType);
  }

  private isOutboundPackingStatus(value: string): value is OutboundPackingStatus {
    return Object.values(OutboundPackingStatus).includes(value as OutboundPackingStatus);
  }

  private isOutboundAllocationStatus(value: string): value is OutboundAllocationStatus {
    return Object.values(OutboundAllocationStatus).includes(value as OutboundAllocationStatus);
  }

  private isInventorySnapshotRunMode(value: string): value is InventorySnapshotRunMode {
    return Object.values(InventorySnapshotRunMode).includes(value as InventorySnapshotRunMode);
  }

  private readOptionalPositiveMeasure(value: unknown, fieldName: string): number | undefined {
    if (readOptionalString(value) === undefined && typeof value !== "number") {
      return undefined;
    }

    return readPositiveDecimal(value, fieldName);
  }

  private readOptionalDate(value: unknown, fieldName: string): Date | undefined {
    const text = readOptionalString(value);
    if (!text) {
      return undefined;
    }

    const date = new Date(text);
    if (Number.isNaN(date.getTime())) {
      throw validationFailed({
        [fieldName]: `${fieldName} must be an ISO 8601 date/time`
      });
    }

    return date;
  }

  private readRequiredBusinessDate(
    value: unknown,
    fieldName: string
  ): {
    text: string;
    date: Date;
    snapshotAt: Date;
  } {
    const text = readOptionalString(value);
    if (!text) {
      throw validationFailed(
        {
          [fieldName]: `${fieldName} is required`
        },
        "WMS_SNAPSHOT_DATE_REQUIRED",
        "Inventory snapshot date is required"
      );
    }

    return this.parseBusinessDate(text, fieldName);
  }

  private readOptionalBusinessDate(value: unknown, fieldName: string): Date | undefined {
    const text = readOptionalString(value);
    return text ? this.parseBusinessDate(text, fieldName).date : undefined;
  }

  private parseBusinessDate(
    text: string,
    fieldName: string
  ): {
    text: string;
    date: Date;
    snapshotAt: Date;
  } {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
      throw validationFailed({
        [fieldName]: `${fieldName} must use YYYY-MM-DD format`
      });
    }

    const date = new Date(`${text}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
      throw validationFailed({
        [fieldName]: `${fieldName} must be a valid calendar date`
      });
    }

    return {
      text,
      date,
      snapshotAt: new Date(`${text}T14:59:59.999Z`)
    };
  }

  private assertPackableAllocations(
    allocations: Array<{
      id: string;
      outboundOrderId: string;
      warehouseId: string;
      status: string;
      outboundOrder: {
        orderNo: string;
      };
    }>,
    allocationIds: string[],
    requestedOutboundOrderId?: string
  ): {
    outboundOrderId: string;
    warehouseId: string;
    orderNo: string;
  } {
    const foundIds = new Set(allocations.map((allocation) => allocation.id));
    const missingAllocationId = allocationIds.find((allocationId) => !foundIds.has(allocationId));
    if (missingAllocationId || allocations.length !== allocationIds.length) {
      throw new NotFoundException({
        code: "WMS_OUTBOUND_ALLOCATION_NOT_FOUND",
        message: "Outbound allocation not found"
      });
    }

    const notAllocated = allocations.find((allocation) => allocation.status !== OutboundAllocationStatus.allocated);
    if (notAllocated) {
      throw new ConflictException({
        code: "WMS_OUTBOUND_ALLOCATION_NOT_ALLOCATED",
        message: "Outbound allocation is not allocated"
      });
    }

    const first = allocations[0];
    const mismatched = allocations.find(
      (allocation) => allocation.outboundOrderId !== first.outboundOrderId || allocation.warehouseId !== first.warehouseId
    );
    if (mismatched || (requestedOutboundOrderId && requestedOutboundOrderId !== first.outboundOrderId)) {
      throw new ConflictException({
        code: "WMS_PACKING_ALLOCATION_MISMATCH",
        message: "Packing allocations must belong to the same outbound order and warehouse"
      });
    }

    return {
      outboundOrderId: first.outboundOrderId,
      warehouseId: first.warehouseId,
      orderNo: first.outboundOrder.orderNo
    };
  }

  private assertPackingQuantitiesMatch(packing: {
    allocations: Array<{
      allocationId: string;
      allocation: {
        quantity: Prisma.Decimal;
      };
    }>;
    packages: Array<{
      items: Array<{
        allocationId: string;
        quantity: Prisma.Decimal;
      }>;
    }>;
  }) {
    const expectedQuantities = new Map<string, number>();
    for (const link of packing.allocations) {
      expectedQuantities.set(link.allocationId, this.decimalToNumber(link.allocation.quantity));
    }

    const packedQuantities = new Map<string, number>();
    for (const outboundPackage of packing.packages) {
      for (const item of outboundPackage.items) {
        const current = packedQuantities.get(item.allocationId) ?? 0;
        packedQuantities.set(item.allocationId, this.roundQuantity(current + this.decimalToNumber(item.quantity)));
      }
    }

    const invalidPackageAllocation = [...packedQuantities.keys()].find((allocationId) => !expectedQuantities.has(allocationId));
    const mismatches = [...expectedQuantities.entries()]
      .map(([allocationId, expectedQuantity]) => {
        const packedQuantity = packedQuantities.get(allocationId) ?? 0;
        return {
          allocationId,
          expectedQuantity,
          packedQuantity
        };
      })
      .filter((quantity) => this.roundQuantity(quantity.expectedQuantity) !== this.roundQuantity(quantity.packedQuantity));

    if (invalidPackageAllocation || mismatches.length > 0) {
      throw new UnprocessableEntityException({
        code: "WMS_PACKAGE_QUANTITY_MISMATCH",
        message: "Packed package quantities must match allocation quantities",
        details: {
          invalidAllocationId: invalidPackageAllocation ?? null,
          allocations: mismatches.map((quantity) => ({
            allocationId: quantity.allocationId,
            expectedQuantity: quantity.expectedQuantity.toFixed(3),
            packedQuantity: quantity.packedQuantity.toFixed(3)
          }))
        }
      });
    }
  }

  private totalPackedQuantity(packing: {
    packages: Array<{
      items: Array<{
        quantity: Prisma.Decimal;
      }>;
    }>;
  }): number {
    return this.roundQuantity(
      packing.packages.reduce(
        (total, outboundPackage) =>
          total + outboundPackage.items.reduce((packageTotal, item) => packageTotal + this.decimalToNumber(item.quantity), 0),
        0
      )
    );
  }

  private async ensureWarehouse(tenantId: string, warehouseId: string) {
    const warehouse = await this.prismaService.warehouse.findFirst({
      where: {
        id: warehouseId,
        tenantId
      },
      select: {
        id: true
      }
    });
    if (!warehouse) {
      throw new NotFoundException({
        code: "WMS_WAREHOUSE_NOT_FOUND",
        message: "Warehouse not found"
      });
    }
  }

  private async ensureStockReferences(
    tx: Prisma.TransactionClient,
    tenantId: string,
    warehouseId: string,
    locationId: string,
    itemId: string
  ) {
    const [warehouse, location, item] = await Promise.all([
      tx.warehouse.findFirst({
        where: {
          id: warehouseId,
          tenantId
        },
        select: {
          id: true
        }
      }),
      tx.location.findFirst({
        where: {
          id: locationId,
          tenantId,
          warehouseId
        },
        select: {
          id: true
        }
      }),
      tx.item.findFirst({
        where: {
          id: itemId,
          tenantId
        },
        select: {
          id: true
        }
      })
    ]);

    const fields: Record<string, string> = {};
    if (!warehouse) {
      fields.warehouseId = "warehouseId was not found for tenant";
    }
    if (!location) {
      fields.locationId = "locationId was not found for tenant and warehouse";
    }
    if (!item) {
      fields.itemId = "itemId was not found for tenant";
    }

    if (Object.keys(fields).length > 0) {
      throw validationFailed(fields, "WMS_REFERENCE_NOT_FOUND", "WMS reference not found");
    }
  }

  private async applyQuantityChange(
    tx: Prisma.TransactionClient,
    tenantId: string,
    warehouseId: string,
    locationId: string,
    itemId: string,
    command: Omit<InventoryMovementCommand, "allocatedQuantityChange">
  ): Promise<InventoryBalance> {
    return this.applyInventoryMovement(tx, tenantId, warehouseId, locationId, itemId, {
      ...command,
      allocatedQuantityChange: 0
    });
  }

  private async applyAllocation(
    tx: Prisma.TransactionClient,
    tenantId: string,
    warehouseId: string,
    locationId: string,
    itemId: string,
    quantity: number,
    command: Omit<InventoryMovementCommand, "quantityChange" | "allocatedQuantityChange">
  ) {
    const balance = await tx.inventoryBalance.findUnique({
      where: {
        tenantId_warehouseId_locationId_itemId: {
          tenantId,
          warehouseId,
          locationId,
          itemId
        }
      }
    });
    const availableQuantity = this.decimalToNumber(balance?.quantity ?? 0) - this.decimalToNumber(balance?.allocatedQuantity ?? 0);
    if (!balance || availableQuantity < quantity) {
      throw new UnprocessableEntityException({
        code: "WMS_INSUFFICIENT_STOCK",
        message: "Inventory available quantity is insufficient"
      });
    }

    await this.applyInventoryMovement(tx, tenantId, warehouseId, locationId, itemId, {
      ...command,
      quantityChange: 0,
      allocatedQuantityChange: quantity
    });
  }

  private async applyShipment(
    tx: Prisma.TransactionClient,
    tenantId: string,
    warehouseId: string,
    locationId: string,
    itemId: string,
    quantity: number,
    command: Omit<InventoryMovementCommand, "quantityChange" | "allocatedQuantityChange">
  ) {
    await this.applyInventoryMovement(tx, tenantId, warehouseId, locationId, itemId, {
      ...command,
      quantityChange: -quantity,
      allocatedQuantityChange: -quantity
    });
  }

  private async applyInventoryMovement(
    tx: Prisma.TransactionClient,
    tenantId: string,
    warehouseId: string,
    locationId: string,
    itemId: string,
    command: InventoryMovementCommand
  ): Promise<InventoryBalance> {
    await this.ensureCorrectedLedgerReference(tx, tenantId, warehouseId, locationId, itemId, command);
    const current = await tx.inventoryBalance.findUnique({
      where: {
        tenantId_warehouseId_locationId_itemId: {
          tenantId,
          warehouseId,
          locationId,
          itemId
        }
      }
    });
    const nextQuantity = this.roundQuantity(this.decimalToNumber(current?.quantity ?? 0) + command.quantityChange);
    const nextAllocatedQuantity = this.roundQuantity(
      this.decimalToNumber(current?.allocatedQuantity ?? 0) + command.allocatedQuantityChange
    );
    if (nextQuantity < 0 || nextAllocatedQuantity < 0) {
      throw new UnprocessableEntityException({
        code: "WMS_INSUFFICIENT_STOCK",
        message: "Inventory quantity is insufficient"
      });
    }

    const balance = await tx.inventoryBalance.upsert({
      where: {
        tenantId_warehouseId_locationId_itemId: {
          tenantId,
          warehouseId,
          locationId,
          itemId
        }
      },
      create: {
        tenantId,
        warehouseId,
        locationId,
        itemId,
        quantity: nextQuantity,
        allocatedQuantity: nextAllocatedQuantity
      },
      update: {
        quantity: nextQuantity,
        allocatedQuantity: nextAllocatedQuantity
      }
    });

    await tx.inventoryLedger.create({
      data: {
        tenantId,
        warehouseId,
        locationId,
        itemId,
        movementType: command.movementType,
        sourceType: command.sourceType,
        sourceId: command.sourceId,
        quantityChange: command.quantityChange,
        allocatedQuantityChange: command.allocatedQuantityChange,
        balanceQuantityAfter: nextQuantity,
        balanceAllocatedQuantityAfter: nextAllocatedQuantity,
        effectiveDate: command.effectiveDate,
        correctedLedgerId: command.correctedLedgerId,
        correctionReason: command.correctionReason,
        requestId: command.requestId ?? "unknown"
      }
    });

    return balance;
  }

  private async ensureCorrectedLedgerReference(
    tx: Prisma.TransactionClient,
    tenantId: string,
    warehouseId: string,
    locationId: string,
    itemId: string,
    command: InventoryMovementCommand
  ) {
    if (!command.correctedLedgerId) {
      return;
    }

    const correctedLedger = await tx.inventoryLedger.findFirst({
      where: {
        id: command.correctedLedgerId,
        tenantId
      },
      select: {
        warehouseId: true,
        locationId: true,
        itemId: true
      }
    });
    if (!correctedLedger) {
      throw new NotFoundException({
        code: "WMS_LEDGER_NOT_FOUND",
        message: "Corrected inventory ledger row was not found"
      });
    }
    if (
      correctedLedger.warehouseId !== warehouseId ||
      correctedLedger.locationId !== locationId ||
      correctedLedger.itemId !== itemId
    ) {
      throw validationFailed(
        {
          correctedLedgerId: "correctedLedgerId must reference the same warehouse, location, and item"
        },
        "WMS_LEDGER_REFERENCE_MISMATCH",
        "Corrected ledger reference does not match inventory key"
      );
    }
  }

  private async findSnapshotSourceRows(
    tx: Prisma.TransactionClient,
    tenantId: string,
    snapshotDate: string,
    warehouseId?: string
  ): Promise<SnapshotSourceRow[]> {
    const warehouseFilter = warehouseId ? Prisma.sql`AND "warehouse_id" = CAST(${warehouseId} AS uuid)` : Prisma.empty;

    return tx.$queryRaw<SnapshotSourceRow[]>(Prisma.sql`
      SELECT DISTINCT ON ("tenant_id", "warehouse_id", "location_id", "item_id")
        "id"::text AS "ledgerId",
        "warehouse_id"::text AS "warehouseId",
        "location_id"::text AS "locationId",
        "item_id"::text AS "itemId",
        "balance_quantity_after"::text AS "quantity",
        "balance_allocated_quantity_after"::text AS "allocatedQuantity"
      FROM "wms_inventory_ledger"
      WHERE "tenant_id" = CAST(${tenantId} AS uuid)
        AND "effective_date" <= CAST(${snapshotDate} AS date)
        ${warehouseFilter}
      ORDER BY
        "tenant_id",
        "warehouse_id",
        "location_id",
        "item_id",
        "effective_date" DESC,
        "occurred_at" DESC,
        "id" DESC
    `);
  }

  private snapshotKey(value: { warehouseId: string; locationId: string; itemId: string }): string {
    return `${value.warehouseId}:${value.locationId}:${value.itemId}`;
  }

  private async findOrCreateOutboundOrder(
    tx: Prisma.TransactionClient,
    tenantId: string,
    warehouseId: string,
    orderNo: string
  ) {
    const existingOrder = await tx.outboundOrder.findUnique({
      where: {
        tenantId_orderNo: {
          tenantId,
          orderNo
        }
      }
    });
    if (existingOrder) {
      if (existingOrder.warehouseId !== warehouseId) {
        throw new ConflictException({
          code: "WMS_OUTBOUND_ORDER_WAREHOUSE_MISMATCH",
          message: "Outbound order belongs to a different warehouse"
        });
      }

      if (existingOrder.status === OutboundOrderStatus.shipped || existingOrder.status === OutboundOrderStatus.cancelled) {
        throw new ConflictException({
          code: "WMS_OUTBOUND_ORDER_CLOSED",
          message: "Outbound order is already closed"
        });
      }

      return existingOrder;
    }

    return tx.outboundOrder.create({
      data: {
        tenantId,
        warehouseId,
        orderNo,
        status: OutboundOrderStatus.allocated
      }
    });
  }

  private async refreshOutboundOrderStatus(
    tx: Prisma.TransactionClient,
    tenantId: string,
    outboundOrderId: string,
    shippedAt: Date
  ) {
    const remainingAllocated = await tx.outboundAllocation.count({
      where: {
        tenantId,
        outboundOrderId,
        status: OutboundAllocationStatus.allocated
      }
    });
    if (remainingAllocated > 0) {
      return;
    }

    await tx.outboundOrder.update({
      where: {
        id: outboundOrderId
      },
      data: {
        status: OutboundOrderStatus.shipped,
        shippedAt
      }
    });
  }

  private businessDateFromDate(date: Date): Date {
    const seoulDateText = new Date(date.getTime() + SEOUL_UTC_OFFSET_MS).toISOString().slice(0, 10);
    return this.parseBusinessDate(seoulDateText, "businessDate").date;
  }

  private formatBusinessDate(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  private decimalToNumber(value: Prisma.Decimal | number): number {
    return typeof value === "number" ? value : Number(value.toString());
  }

  private roundQuantity(value: number): number {
    return Math.round(value * 1000) / 1000;
  }

  private toWarehouseResponse(warehouse: {
    id: string;
    tenantId: string;
    code: string;
    name: string;
    status: string;
    createdAt: Date;
    updatedAt: Date;
  }): WarehouseResponse {
    return {
      warehouseId: warehouse.id,
      tenantId: warehouse.tenantId,
      code: warehouse.code,
      name: warehouse.name,
      status: warehouse.status,
      createdAt: warehouse.createdAt.toISOString(),
      updatedAt: warehouse.updatedAt.toISOString()
    };
  }

  private toLocationResponse(location: {
    id: string;
    tenantId: string;
    warehouseId: string;
    code: string;
    name: string | null;
    type: string;
    status: string;
    createdAt: Date;
    updatedAt: Date;
  }): LocationResponse {
    return {
      locationId: location.id,
      tenantId: location.tenantId,
      warehouseId: location.warehouseId,
      code: location.code,
      name: location.name,
      type: location.type,
      status: location.status,
      createdAt: location.createdAt.toISOString(),
      updatedAt: location.updatedAt.toISOString()
    };
  }

  private toItemResponse(item: {
    id: string;
    tenantId: string;
    sku: string;
    name: string;
    uom: string;
    status: string;
    createdAt: Date;
    updatedAt: Date;
  }): ItemResponse {
    return {
      itemId: item.id,
      tenantId: item.tenantId,
      sku: item.sku,
      name: item.name,
      uom: item.uom,
      status: item.status,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString()
    };
  }

  private toInventoryBalanceResponse(balance: InventoryBalance): InventoryBalanceResponse {
    const quantity = this.decimalToNumber(balance.quantity);
    const allocatedQuantity = this.decimalToNumber(balance.allocatedQuantity);
    return {
      balanceId: balance.id,
      tenantId: balance.tenantId,
      warehouseId: balance.warehouseId,
      locationId: balance.locationId,
      itemId: balance.itemId,
      quantity: balance.quantity.toString(),
      allocatedQuantity: balance.allocatedQuantity.toString(),
      availableQuantity: (quantity - allocatedQuantity).toFixed(3),
      updatedAt: balance.updatedAt.toISOString()
    };
  }

  private toInventoryAdjustmentResponse(adjustment: {
    id: string;
    tenantId: string;
    warehouseId: string;
    locationId: string;
    itemId: string;
    quantityChange: Prisma.Decimal;
    reason: string;
    referenceNo: string | null;
    memo: string | null;
    adjustedBy: string | null;
    effectiveDate: Date;
    correctedLedgerId: string | null;
    correctionReason: string | null;
    createdAt: Date;
  }): InventoryAdjustmentResponse {
    return {
      adjustmentId: adjustment.id,
      tenantId: adjustment.tenantId,
      warehouseId: adjustment.warehouseId,
      locationId: adjustment.locationId,
      itemId: adjustment.itemId,
      quantityChange: adjustment.quantityChange.toString(),
      reason: adjustment.reason,
      referenceNo: adjustment.referenceNo,
      memo: adjustment.memo,
      adjustedBy: adjustment.adjustedBy,
      effectiveDate: this.formatBusinessDate(adjustment.effectiveDate),
      correctedLedgerId: adjustment.correctedLedgerId,
      correctionReason: adjustment.correctionReason,
      createdAt: adjustment.createdAt.toISOString()
    };
  }

  private toInventoryDailySnapshotResponse(snapshot: {
    id: string;
    tenantId: string;
    snapshotDate: Date;
    snapshotAt: Date;
    warehouseId: string;
    locationId: string;
    itemId: string;
    quantity: Prisma.Decimal;
    allocatedQuantity: Prisma.Decimal;
    availableQuantity: Prisma.Decimal;
    sourceLedgerId: string | null;
    runId: string;
    previousSnapshotId: string | null;
    isCurrent: boolean;
    generatedAt: Date;
  }): InventoryDailySnapshotResponse {
    return {
      snapshotId: snapshot.id,
      tenantId: snapshot.tenantId,
      snapshotDate: this.formatBusinessDate(snapshot.snapshotDate),
      snapshotAt: snapshot.snapshotAt.toISOString(),
      warehouseId: snapshot.warehouseId,
      locationId: snapshot.locationId,
      itemId: snapshot.itemId,
      quantity: snapshot.quantity.toString(),
      allocatedQuantity: snapshot.allocatedQuantity.toString(),
      availableQuantity: snapshot.availableQuantity.toString(),
      sourceLedgerId: snapshot.sourceLedgerId,
      runId: snapshot.runId,
      previousSnapshotId: snapshot.previousSnapshotId,
      isCurrent: snapshot.isCurrent,
      generatedAt: snapshot.generatedAt.toISOString()
    };
  }

  private toInventorySnapshotRunResponse(run: {
    id: string;
    tenantId: string;
    snapshotDate: Date;
    snapshotAt: Date;
    warehouseId: string | null;
    mode: string;
    status: string;
    generatedCount: number;
    unchangedCount: number;
    errorCode: string | null;
    createdBy: string | null;
    requestId: string;
    startedAt: Date;
    finishedAt: Date | null;
  }): InventorySnapshotRunResponse {
    return {
      runId: run.id,
      tenantId: run.tenantId,
      snapshotDate: this.formatBusinessDate(run.snapshotDate),
      snapshotAt: run.snapshotAt.toISOString(),
      warehouseId: run.warehouseId,
      mode: run.mode,
      status: run.status,
      generatedCount: run.generatedCount,
      unchangedCount: run.unchangedCount,
      errorCode: run.errorCode,
      createdBy: run.createdBy,
      requestId: run.requestId,
      startedAt: run.startedAt.toISOString(),
      finishedAt: run.finishedAt?.toISOString() ?? null
    };
  }

  private toInboundReceiptResponse(receipt: {
    id: string;
    tenantId: string;
    warehouseId: string;
    locationId: string;
    itemId: string;
    quantity: Prisma.Decimal;
    referenceNo: string | null;
    confirmedBy: string | null;
    confirmedAt: Date;
    createdAt: Date;
  }): InboundReceiptResponse {
    return {
      receiptId: receipt.id,
      tenantId: receipt.tenantId,
      warehouseId: receipt.warehouseId,
      locationId: receipt.locationId,
      itemId: receipt.itemId,
      quantity: receipt.quantity.toString(),
      referenceNo: receipt.referenceNo,
      confirmedBy: receipt.confirmedBy,
      confirmedAt: receipt.confirmedAt.toISOString(),
      createdAt: receipt.createdAt.toISOString()
    };
  }

  private toOutboundAllocationResponse(allocation: {
    id: string;
    outboundOrderId: string;
    tenantId: string;
    warehouseId: string;
    locationId: string;
    itemId: string;
    quantity: Prisma.Decimal;
    status: string;
    allocatedBy: string | null;
    allocatedAt: Date;
    shippedBy: string | null;
    shippedAt: Date | null;
    outboundOrder: {
      orderNo: string;
    };
  }): OutboundAllocationResponse {
    return {
      allocationId: allocation.id,
      outboundOrderId: allocation.outboundOrderId,
      tenantId: allocation.tenantId,
      orderNo: allocation.outboundOrder.orderNo,
      warehouseId: allocation.warehouseId,
      locationId: allocation.locationId,
      itemId: allocation.itemId,
      quantity: allocation.quantity.toString(),
      status: allocation.status,
      allocatedBy: allocation.allocatedBy,
      allocatedAt: allocation.allocatedAt.toISOString(),
      shippedBy: allocation.shippedBy,
      shippedAt: allocation.shippedAt?.toISOString() ?? null
    };
  }

  private toOutboundPackingResponse(packing: {
    id: string;
    tenantId: string;
    outboundOrderId: string;
    warehouseId: string;
    status: string;
    memo: string | null;
    packedBy: string | null;
    confirmedBy: string | null;
    confirmedAt: Date | null;
    shippedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    outboundOrder: {
      orderNo: string;
    };
    allocations: Array<{
      allocationId: string;
    }>;
    packages: Array<{
      id: string;
    }>;
  }): OutboundPackingResponse {
    return {
      packingId: packing.id,
      tenantId: packing.tenantId,
      outboundOrderId: packing.outboundOrderId,
      orderNo: packing.outboundOrder.orderNo,
      warehouseId: packing.warehouseId,
      status: packing.status,
      allocationIds: packing.allocations.map((allocation) => allocation.allocationId),
      packageIds: packing.packages.map((outboundPackage) => outboundPackage.id),
      packageCount: packing.packages.length,
      memo: packing.memo,
      packedBy: packing.packedBy,
      confirmedBy: packing.confirmedBy,
      confirmedAt: packing.confirmedAt?.toISOString() ?? null,
      shippedAt: packing.shippedAt?.toISOString() ?? null,
      createdAt: packing.createdAt.toISOString(),
      updatedAt: packing.updatedAt.toISOString()
    };
  }

  private toOutboundPackageResponse(outboundPackage: {
    id: string;
    tenantId: string;
    packingId: string;
    packageNo: string;
    boxType: string | null;
    weight: Prisma.Decimal | null;
    width: Prisma.Decimal | null;
    height: Prisma.Decimal | null;
    depth: Prisma.Decimal | null;
    createdAt: Date;
    updatedAt: Date;
    items: Array<{
      id: string;
      allocationId: string;
      itemId: string;
      quantity: Prisma.Decimal;
      createdAt: Date;
    }>;
  }): OutboundPackageResponse {
    return {
      packageId: outboundPackage.id,
      tenantId: outboundPackage.tenantId,
      packingId: outboundPackage.packingId,
      packageNo: outboundPackage.packageNo,
      boxType: outboundPackage.boxType,
      weight: outboundPackage.weight?.toString() ?? null,
      width: outboundPackage.width?.toString() ?? null,
      height: outboundPackage.height?.toString() ?? null,
      depth: outboundPackage.depth?.toString() ?? null,
      items: outboundPackage.items.map((item) => ({
        packageItemId: item.id,
        allocationId: item.allocationId,
        itemId: item.itemId,
        quantity: item.quantity.toString(),
        createdAt: item.createdAt.toISOString()
      })),
      createdAt: outboundPackage.createdAt.toISOString(),
      updatedAt: outboundPackage.updatedAt.toISOString()
    };
  }

  private toOutboundShipmentResponse(shipment: {
    id: string;
    tenantId: string;
    packingId: string | null;
    allocationId: string | null;
    outboundOrderId: string;
    warehouseId: string;
    carrierCode: string | null;
    trackingNo: string | null;
    shippedBy: string | null;
    shippedAt: Date;
    createdAt: Date;
    outboundOrder: {
      orderNo: string;
    };
  }): OutboundShipmentResponse {
    return {
      shipmentId: shipment.id,
      tenantId: shipment.tenantId,
      packingId: shipment.packingId,
      allocationId: shipment.allocationId,
      outboundOrderId: shipment.outboundOrderId,
      orderNo: shipment.outboundOrder.orderNo,
      warehouseId: shipment.warehouseId,
      carrierCode: shipment.carrierCode,
      trackingNo: shipment.trackingNo,
      shippedBy: shipment.shippedBy,
      shippedAt: shipment.shippedAt.toISOString(),
      createdAt: shipment.createdAt.toISOString()
    };
  }
}

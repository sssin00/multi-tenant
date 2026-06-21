#!/usr/bin/env node
import { createHash, createHmac } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";

const children = [];
const runId = Date.now().toString(36);

const config = {
  region: process.env.AWS_REGION ?? "ap-northeast-2",
  queueName: process.env.LOCAL_WMS_SQS_QUEUE_NAME ?? `multi-tenant-local-wms-audit-events-${runId}-queue`,
  localstackEndpoint: process.env.LOCALSTACK_ENDPOINT ?? "http://localhost:4566",
  wmsBaseUrl: process.env.LOCAL_WMS_SERVICE_URL ?? "http://127.0.0.1:3005",
  authBaseUrl: process.env.LOCAL_AUTH_IAM_SERVICE_URL ?? "http://127.0.0.1:3001",
  tenantBaseUrl: process.env.LOCAL_TENANT_SERVICE_URL ?? "http://127.0.0.1:3002",
  auditPort: process.env.LOCAL_WMS_AUDIT_PORT ?? "3116",
  outboxPort: process.env.LOCAL_WMS_OUTBOX_PORT ?? "3117",
  tenantId: process.env.LOCAL_VERIFY_TENANT_ID ?? "11111111-1111-4111-8111-111111111111",
  userId: process.env.LOCAL_VERIFY_USER_ID ?? "22222222-2222-4222-8222-222222222222",
  postgresContainer: process.env.LOCAL_POSTGRES_CONTAINER ?? "multi-tenant-postgres",
  authDatabaseUrl: process.env.LOCAL_AUTH_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:55432/auth_iam",
  wmsDatabase: process.env.LOCAL_WMS_DATABASE ?? "wms",
  auditDatabase: process.env.LOCAL_AUDIT_DATABASE ?? "audit_log",
  wmsDatabaseUrl: process.env.LOCAL_WMS_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:55432/wms",
  auditDatabaseUrl: process.env.LOCAL_AUDIT_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:55432/audit_log",
  wmsInternalSecret: process.env.LOCAL_WMS_INTERNAL_SECRET ?? "replace-with-local-wms-internal-secret-32chars",
  auditInternalSecret: process.env.LOCAL_AUDIT_INTERNAL_SECRET ?? "local-audit-internal-secret-32chars",
  localOutboxRelayContainer: process.env.LOCAL_OUTBOX_RELAY_CONTAINER ?? "multi-tenant-outbox-relay-service",
  pauseLocalOutboxRelay: process.env.LOCAL_WMS_PAUSE_LOCAL_OUTBOX_RELAY !== "false"
};

async function main() {
  ensureRequiredCommands();
  await ensureDockerDependencies();
  await ensureServiceReady(`${config.authBaseUrl}/ready`, "auth-iam-service");
  await ensureServiceReady(`${config.tenantBaseUrl}/ready`, "tenant-service");
  await ensureAuthSeed();
  await ensureWmsSchema();
  await ensureAuditSchema();
  await ensureServiceReady(`${config.wmsBaseUrl}/ready`, "wms-service");

  const pausedOutboxRelayContainer = await pauseLocalOutboxRelayIfNeeded();
  let auditProcess;
  let outboxProcess;

  try {
    const queueUrl = await createQueue();
    await purgeQueue(queueUrl);

    auditProcess = startProcess("audit-log-service", {
      AUDIT_PORT: config.auditPort,
      NODE_ENV: "development",
      APP_ENV: "local",
      LOG_LEVEL: "debug",
      AWS_REGION: config.region,
      AWS_ACCESS_KEY_ID: "test",
      AWS_SECRET_ACCESS_KEY: "test",
      DATABASE_URL: config.auditDatabaseUrl,
      AUDIT_INTERNAL_AUTH_SECRET: config.auditInternalSecret,
      AUDIT_EVENT_CONSUMER_ENABLED: "true",
      AUDIT_EVENT_QUEUE_URL: queueUrl,
      AUDIT_EVENT_SQS_ENDPOINT: config.localstackEndpoint,
      AUDIT_EVENT_POLL_INTERVAL_MS: "1000",
      AUDIT_EVENT_WAIT_TIME_SECONDS: "1",
      AUDIT_EVENT_BATCH_SIZE: "10"
    });

    outboxProcess = startProcess("outbox-relay-service", {
      OUTBOX_PORT: config.outboxPort,
      NODE_ENV: "development",
      APP_ENV: "local",
      LOG_LEVEL: "debug",
      AWS_REGION: config.region,
      AWS_ACCESS_KEY_ID: "test",
      AWS_SECRET_ACCESS_KEY: "test",
      OUTBOX_WORKER_ENABLED: "true",
      OUTBOX_SOURCES: "wms",
      OUTBOX_PUBLISHER_TYPE: "sqs",
      OUTBOX_POLL_INTERVAL_MS: "1000",
      OUTBOX_BATCH_SIZE: "10",
      OUTBOX_MAX_RETRY_COUNT: "3",
      OUTBOX_LOCK_TIMEOUT_SECONDS: "30",
      OUTBOX_EVENT_SOURCE_PREFIX: "multi-tenant.local",
      OUTBOX_SQS_QUEUE_URL: queueUrl,
      OUTBOX_SQS_ENDPOINT: config.localstackEndpoint,
      OUTBOX_SQS_MESSAGE_GROUP_STRATEGY: "aggregateId",
      WMS_OUTBOX_DATABASE_URL: config.wmsDatabaseUrl
    });

    await ensureServiceReady(`http://127.0.0.1:${config.auditPort}/ready`, "audit-log-service test consumer");
    await ensureServiceReady(`http://127.0.0.1:${config.outboxPort}/ready`, "outbox-relay-service test publisher");

    const report = await runScenarios();

    console.log("\nLocal WMS integration verification passed");
    console.table(report);
  } finally {
    auditProcess?.kill();
    outboxProcess?.kill();
    await resumeLocalOutboxRelayIfNeeded(pausedOutboxRelayContainer);
  }
}

async function runScenarios() {
  const warehouseCode = `wh${runId}`;
  const locationCode = `loc${runId}`;
  const sku = `sku${runId}`;
  const orderNo = `so-${runId}`;
  const requestId = (name) => `wms-${runId}-${name}`;

  const createWarehouse = await wmsRequest("POST", "/api/internal/wms/warehouses", {
    code: warehouseCode,
    name: `Local Warehouse ${runId}`
  }, requestId("int-001-warehouse"));
  const warehouseId = createWarehouse.data.warehouseId;

  const createLocation = await wmsRequest("POST", "/api/internal/wms/locations", {
    warehouseId,
    code: locationCode,
    name: `Storage ${runId}`,
    type: "storage"
  }, requestId("int-001-location"));
  const locationId = createLocation.data.locationId;

  const createItem = await wmsRequest("POST", "/api/internal/wms/items", {
    sku,
    name: `Item ${runId}`,
    uom: "ea"
  }, requestId("int-001-item"));
  const itemId = createItem.data.itemId;

  const listItems = await wmsRequest("GET", `/api/internal/wms/items?sku=${encodeURIComponent(sku)}`, undefined, requestId("int-001-list-items"));
  assertPageEnvelope(listItems.data, "WMS-INT-001 item list");
  assert(listItems.data.total >= 1, "WMS-INT-001 item list should include created item");

  const adjustmentRequestId = requestId("int-002-adjust");
  const adjustment = await wmsRequest("POST", "/api/internal/wms/inventory/adjustments", {
    warehouseId,
    locationId,
    itemId,
    quantityChange: 20,
    reason: "cycle-count",
    referenceNo: `adj-${runId}`
  }, adjustmentRequestId);
  await waitForEventPublishedAndAudited(adjustmentRequestId, "wms.inventory.adjusted");

  const inboundRequestId = requestId("int-003-inbound");
  const inbound = await wmsRequest("POST", "/api/internal/wms/inbound/confirmations", {
    warehouseId,
    locationId,
    itemId,
    quantity: 5,
    referenceNo: `in-${runId}`
  }, inboundRequestId);
  await waitForEventPublishedAndAudited(inboundRequestId, "wms.inbound.confirmed");

  let inventory = await wmsRequest("GET", `/api/internal/wms/inventory?warehouseId=${warehouseId}&locationId=${locationId}&itemId=${itemId}`, undefined, requestId("int-003-inventory-after-inbound"));
  assertPageEnvelope(inventory.data, "WMS-INV-001 inventory list");
  assert(inventory.data.items[0].quantity === "25", `expected quantity 25, got ${inventory.data.items[0].quantity}`);
  assertDecimalEquals(inventory.data.items[0].availableQuantity, 25, "WMS-INV-001 availableQuantity");
  const inventoryAfterInbound = inventory;

  const allocationRequestId = requestId("int-004-allocate");
  const allocation = await wmsRequest("POST", "/api/internal/wms/outbound/allocations", {
    orderNo,
    warehouseId,
    locationId,
    itemId,
    quantity: 7
  }, allocationRequestId);
  await waitForEventPublishedAndAudited(allocationRequestId, "wms.outbound.allocated");

  inventory = await wmsRequest("GET", `/api/internal/wms/inventory?warehouseId=${warehouseId}&locationId=${locationId}&itemId=${itemId}`, undefined, requestId("int-004-inventory-after-allocation"));
  assert(inventory.data.items[0].allocatedQuantity === "7", `expected allocated 7, got ${inventory.data.items[0].allocatedQuantity}`);

  const shipmentRequestId = requestId("int-005-ship");
  const shipment = await wmsRequest("POST", "/api/internal/wms/outbound/shipments", {
    allocationId: allocation.data.allocationId
  }, shipmentRequestId);
  await waitForEventPublishedAndAudited(shipmentRequestId, "wms.outbound.shipped");

  inventory = await wmsRequest("GET", `/api/internal/wms/inventory?warehouseId=${warehouseId}&locationId=${locationId}&itemId=${itemId}`, undefined, requestId("int-005-inventory-after-shipment"));
  assert(inventory.data.items[0].quantity === "18", `expected quantity 18, got ${inventory.data.items[0].quantity}`);
  assert(inventory.data.items[0].allocatedQuantity === "0", `expected allocated 0, got ${inventory.data.items[0].allocatedQuantity}`);
  const directShipmentFinalQuantity = inventory.data.items[0].quantity;

  const packingAllocationRequestId = requestId("pack-001-allocate");
  const packingAllocation = await wmsRequest("POST", "/api/internal/wms/outbound/allocations", {
    orderNo: `${orderNo}-pack`,
    warehouseId,
    locationId,
    itemId,
    quantity: 4
  }, packingAllocationRequestId);
  await waitForEventPublishedAndAudited(packingAllocationRequestId, "wms.outbound.allocated");

  const createPackingRequestId = requestId("pack-001-create");
  const packing = await wmsRequest("POST", "/api/internal/wms/outbound/packings", {
    outboundOrderId: packingAllocation.data.outboundOrderId,
    allocationIds: [packingAllocation.data.allocationId],
    memo: `local packing ${runId}`
  }, createPackingRequestId);
  assert(packing.data.status === "packing", `expected packing status, got ${packing.data.status}`);
  assert(packing.data.allocationIds.includes(packingAllocation.data.allocationId), "packing should include allocation");

  const packageResult = await wmsRequest("POST", `/api/internal/wms/outbound/packings/${packing.data.packingId}/packages`, {
    packageNo: `PKG-${runId}-001`,
    boxType: "small",
    weight: 1.25,
    width: 300,
    height: 200,
    depth: 150,
    items: [
      {
        allocationId: packingAllocation.data.allocationId,
        itemId,
        quantity: 4
      }
    ]
  }, requestId("pack-001-package"));
  assert(packageResult.data.items[0].quantity === "4", `expected packed quantity 4, got ${packageResult.data.items[0].quantity}`);

  const confirmPackingRequestId = requestId("pack-003-confirm");
  const confirmedPacking = await wmsRequest("POST", `/api/internal/wms/outbound/packings/${packing.data.packingId}/confirm`, undefined, confirmPackingRequestId);
  await waitForEventPublishedAndAudited(confirmPackingRequestId, "wms.outbound.packed");
  assert(confirmedPacking.data.status === "confirmed", `expected confirmed packing, got ${confirmedPacking.data.status}`);

  const packingShipmentRequestId = requestId("ship-001-packing");
  const packingShipment = await wmsRequest("POST", "/api/internal/wms/outbound/shipments", {
    packingId: packing.data.packingId,
    carrierCode: "local-carrier",
    trackingNo: `TRK-${runId}`
  }, packingShipmentRequestId);
  await waitForEventPublishedAndAudited(packingShipmentRequestId, "wms.outbound.shipped");

  inventory = await wmsRequest("GET", `/api/internal/wms/inventory?warehouseId=${warehouseId}&locationId=${locationId}&itemId=${itemId}`, undefined, requestId("ship-001-inventory-after-packing-shipment"));
  assert(inventory.data.items[0].quantity === "14", `expected quantity 14, got ${inventory.data.items[0].quantity}`);
  assert(inventory.data.items[0].allocatedQuantity === "0", `expected allocated 0, got ${inventory.data.items[0].allocatedQuantity}`);

  const snapshotDate = seoulBusinessDate();
  const generateSnapshotRequestId = requestId("snap-001-generate");
  const snapshotRun = await wmsRequest("POST", "/api/internal/wms/inventory/snapshots/generate", {
    snapshotDate,
    mode: "generate",
    warehouseId
  }, generateSnapshotRequestId);
  await waitForEventPublishedAndAudited(generateSnapshotRequestId, "wms.inventory.snapshot.generated");
  assert(snapshotRun.data.status === "completed", `expected snapshot run completed, got ${snapshotRun.data.status}`);
  assert(snapshotRun.data.generatedCount >= 1, `expected generated snapshot rows, got ${snapshotRun.data.generatedCount}`);

  const snapshotList = await wmsRequest("GET", `/api/internal/wms/inventory/snapshots?snapshotDate=${snapshotDate}&warehouseId=${warehouseId}&locationId=${locationId}&itemId=${itemId}`, undefined, requestId("snap-003-list"));
  assertPageEnvelope(snapshotList.data, "WMS-SNAP-003 snapshot list");
  const snapshotItem = snapshotList.data.items[0];
  assert(snapshotItem.quantity === "14", `expected snapshot quantity 14, got ${snapshotItem.quantity}`);
  assert(snapshotItem.allocatedQuantity === "0", `expected snapshot allocated 0, got ${snapshotItem.allocatedQuantity}`);
  assert(snapshotItem.sourceLedgerId, "snapshot should include sourceLedgerId");

  const emptySnapshotList = await wmsRequest("GET", `/api/internal/wms/inventory/snapshots?snapshotDate=${snapshotDate}&warehouseId=${warehouseId}&itemId=99999999-9999-4999-8999-999999999999&page=1&size=5`, undefined, requestId("snap-006-empty-filter"));
  assertPageEnvelope(emptySnapshotList.data, "WMS-SNAP-006 empty snapshot list");
  assert(emptySnapshotList.data.items.length === 0, `expected empty snapshot list, got ${emptySnapshotList.data.items.length}`);
  assert(emptySnapshotList.data.total === 0, `expected empty snapshot total 0, got ${emptySnapshotList.data.total}`);

  const rerunSnapshotRequestId = requestId("snap-004-rerun");
  const rerunSnapshot = await wmsRequest("POST", "/api/internal/wms/inventory/snapshots/generate", {
    snapshotDate,
    mode: "generate",
    warehouseId
  }, rerunSnapshotRequestId);
  await waitForEventPublishedAndAudited(rerunSnapshotRequestId, "wms.inventory.snapshot.generated");
  assert(rerunSnapshot.data.generatedCount === 0, `expected idempotent rerun generatedCount 0, got ${rerunSnapshot.data.generatedCount}`);
  assert(rerunSnapshot.data.unchangedCount >= 1, `expected unchanged snapshots, got ${rerunSnapshot.data.unchangedCount}`);

  const correctionRequestId = requestId("snap-002-correction");
  await wmsRequest("POST", "/api/internal/wms/inventory/adjustments", {
    warehouseId,
    locationId,
    itemId,
    quantityChange: 1,
    reason: "backdated-correction",
    referenceNo: `corr-${runId}`,
    effectiveDate: snapshotDate,
    correctedLedgerId: snapshotItem.sourceLedgerId,
    correctionReason: "local snapshot correction verification"
  }, correctionRequestId);
  await waitForEventPublishedAndAudited(correctionRequestId, "wms.inventory.adjusted");

  const rebuildSnapshotRequestId = requestId("snap-002-rebuild");
  const rebuiltSnapshotRun = await wmsRequest("POST", "/api/internal/wms/inventory/snapshots/generate", {
    snapshotDate,
    mode: "rebuild",
    warehouseId
  }, rebuildSnapshotRequestId);
  await waitForEventPublishedAndAudited(rebuildSnapshotRequestId, "wms.inventory.snapshot.generated");
  assert(rebuiltSnapshotRun.data.generatedCount >= 1, `expected rebuilt snapshot rows, got ${rebuiltSnapshotRun.data.generatedCount}`);

  const rebuiltSnapshotList = await wmsRequest("GET", `/api/internal/wms/inventory/snapshots?snapshotDate=${snapshotDate}&warehouseId=${warehouseId}&locationId=${locationId}&itemId=${itemId}`, undefined, requestId("snap-002-list-rebuilt"));
  const rebuiltSnapshotItem = rebuiltSnapshotList.data.items[0];
  assert(rebuiltSnapshotItem.quantity === "15", `expected rebuilt snapshot quantity 15, got ${rebuiltSnapshotItem.quantity}`);
  assert(
    rebuiltSnapshotItem.previousSnapshotId === snapshotItem.snapshotId,
    `expected previousSnapshotId ${snapshotItem.snapshotId}, got ${rebuiltSnapshotItem.previousSnapshotId}`
  );

  const regressionReport = await runRegressionScenarios({
    requestId,
    warehouseCode,
    sku,
    warehouseId,
    locationId,
    itemId,
    allocationId: allocation.data.allocationId,
    shippedPackingId: packing.data.packingId
  });

  return [
    {
      scenarioId: "WMS-INT-001",
      result: "passed",
      evidence: `warehouse=${warehouseId}, location=${locationId}, item=${itemId}`
    },
    {
      scenarioId: "WMS-INT-002",
      result: "passed",
      evidence: `adjustment=${adjustment.data.adjustmentId}, event=wms.inventory.adjusted`
    },
    {
      scenarioId: "WMS-INT-003",
      result: "passed",
      evidence: `receipt=${inbound.data.receiptId}, event=wms.inbound.confirmed`
    },
    {
      scenarioId: "WMS-INT-004",
      result: "passed",
      evidence: `allocation=${allocation.data.allocationId}, event=wms.outbound.allocated`
    },
    {
      scenarioId: "WMS-INT-005",
      result: "passed",
      evidence: `shipment=${shipment.data.allocationId}, finalQuantity=${directShipmentFinalQuantity}`
    },
    {
      scenarioId: "WMS-INV-001",
      result: "passed",
      evidence: `inventory page=${inventoryAfterInbound.data.page}, size=${inventoryAfterInbound.data.size}, total=${inventoryAfterInbound.data.total}, availableQuantity=${inventoryAfterInbound.data.items[0].availableQuantity}`
    },
    {
      scenarioId: "WMS-PACK-001",
      result: "passed",
      evidence: `packing=${packing.data.packingId}, allocation=${packingAllocation.data.allocationId}, status=packing`
    },
    {
      scenarioId: "WMS-PACK-003",
      result: "passed",
      evidence: `packing=${confirmedPacking.data.packingId}, event=wms.outbound.packed`
    },
    {
      scenarioId: "WMS-SHIP-001",
      result: "passed",
      evidence: `shipment=${packingShipment.data.shipmentId}, trackingNo=${packingShipment.data.trackingNo}, finalQuantity=${inventory.data.items[0].quantity}`
    },
    {
      scenarioId: "WMS-SNAP-001",
      result: "passed",
      evidence: `run=${snapshotRun.data.runId}, generated=${snapshotRun.data.generatedCount}, event=wms.inventory.snapshot.generated`
    },
    {
      scenarioId: "WMS-SNAP-002",
      result: "passed",
      evidence: `rebuiltRun=${rebuiltSnapshotRun.data.runId}, previousSnapshot=${rebuiltSnapshotItem.previousSnapshotId}, quantity=${rebuiltSnapshotItem.quantity}`
    },
    {
      scenarioId: "WMS-SNAP-003",
      result: "passed",
      evidence: `snapshot=${snapshotItem.snapshotId}, sourceLedger=${snapshotItem.sourceLedgerId}, quantity=${snapshotItem.quantity}`
    },
    {
      scenarioId: "WMS-SNAP-004",
      result: "passed",
      evidence: `rerun=${rerunSnapshot.data.runId}, generated=${rerunSnapshot.data.generatedCount}, unchanged=${rerunSnapshot.data.unchangedCount}`
    },
    {
      scenarioId: "WMS-SNAP-006",
      result: "passed",
      evidence: `emptyFilterItems=${emptySnapshotList.data.items.length}, total=${emptySnapshotList.data.total}, page=${emptySnapshotList.data.page}, size=${emptySnapshotList.data.size}`
    },
    ...regressionReport
  ];
}

async function runRegressionScenarios({
  requestId,
  warehouseCode,
  sku,
  warehouseId,
  locationId,
  itemId,
  allocationId,
  shippedPackingId
}) {
  const duplicateWarehouseRequestId = requestId("wh-001-duplicate-code");
  await expectWmsFailure(
    "POST",
    "/api/internal/wms/warehouses",
    {
      code: warehouseCode,
      name: `Duplicate Warehouse ${runId}`
    },
    duplicateWarehouseRequestId,
    {
      status: 409,
      code: "WMS_WAREHOUSE_CODE_CONFLICT"
    }
  );

  const duplicateItemRequestId = requestId("item-001-duplicate-sku");
  await expectWmsFailure(
    "POST",
    "/api/internal/wms/items",
    {
      sku,
      name: `Duplicate Item ${runId}`,
      uom: "ea"
    },
    duplicateItemRequestId,
    {
      status: 409,
      code: "WMS_ITEM_SKU_CONFLICT"
    }
  );

  const missingTenantRequestId = requestId("api-001-missing-tenant");
  await expectWmsFailure(
    "GET",
    `/api/internal/wms/inventory?warehouseId=${warehouseId}&locationId=${locationId}&itemId=${itemId}`,
    undefined,
    missingTenantRequestId,
    {
      status: 400,
      code: "TENANT_REQUIRED"
    },
    {
      omitTenant: true
    }
  );

  const invalidUuidRequestId = requestId("api-001-invalid-uuid");
  await expectWmsFailure(
    "GET",
    "/api/internal/wms/inventory?warehouseId=not-a-uuid",
    undefined,
    invalidUuidRequestId,
    {
      status: 400,
      code: "VALIDATION_FAILED"
    }
  );

  const negativeAdjustmentRequestId = requestId("inv-003-negative-adjust");
  await expectWmsFailure(
    "POST",
    "/api/internal/wms/inventory/adjustments",
    {
      warehouseId,
      locationId,
      itemId,
      quantityChange: -999,
      reason: "cycle-count",
      referenceNo: `neg-${runId}`
    },
    negativeAdjustmentRequestId,
    {
      status: 422,
      code: "WMS_INSUFFICIENT_STOCK"
    }
  );
  await assertNoOutboxEvents(negativeAdjustmentRequestId, "wms.inventory.adjusted");

  const insufficientAllocationRequestId = requestId("out-002-insufficient-allocation");
  await expectWmsFailure(
    "POST",
    "/api/internal/wms/outbound/allocations",
    {
      orderNo: `so-short-${runId}`,
      warehouseId,
      locationId,
      itemId,
      quantity: 999
    },
    insufficientAllocationRequestId,
    {
      status: 422,
      code: "WMS_INSUFFICIENT_STOCK"
    }
  );
  await assertNoOutboxEvents(insufficientAllocationRequestId, "wms.outbound.allocated");

  const duplicateShipmentRequestId = requestId("out-004-duplicate-shipment");
  await expectWmsFailure(
    "POST",
    "/api/internal/wms/outbound/shipments",
    {
      allocationId
    },
    duplicateShipmentRequestId,
    {
      status: 409,
      code: "WMS_OUTBOUND_ALLOCATION_NOT_ALLOCATED"
    }
  );
  await assertNoOutboxEvents(duplicateShipmentRequestId, "wms.outbound.shipped");

  const mismatchAllocationRequestId = requestId("pack-002-allocate");
  const mismatchAllocation = await wmsRequest("POST", "/api/internal/wms/outbound/allocations", {
    orderNo: `so-mismatch-${runId}`,
    warehouseId,
    locationId,
    itemId,
    quantity: 2
  }, mismatchAllocationRequestId);
  await waitForEventPublishedAndAudited(mismatchAllocationRequestId, "wms.outbound.allocated");

  const mismatchPacking = await wmsRequest("POST", "/api/internal/wms/outbound/packings", {
    outboundOrderId: mismatchAllocation.data.outboundOrderId,
    allocationIds: [mismatchAllocation.data.allocationId],
    memo: `mismatch packing ${runId}`
  }, requestId("pack-002-create"));

  await wmsRequest("POST", `/api/internal/wms/outbound/packings/${mismatchPacking.data.packingId}/packages`, {
    packageNo: `PKG-${runId}-MISMATCH`,
    items: [
      {
        allocationId: mismatchAllocation.data.allocationId,
        itemId,
        quantity: 1
      }
    ]
  }, requestId("pack-002-package"));

  const mismatchConfirmRequestId = requestId("pack-002-confirm-mismatch");
  await expectWmsFailure(
    "POST",
    `/api/internal/wms/outbound/packings/${mismatchPacking.data.packingId}/confirm`,
    undefined,
    mismatchConfirmRequestId,
    {
      status: 422,
      code: "WMS_PACKAGE_QUANTITY_MISMATCH"
    }
  );
  await assertNoOutboxEvents(mismatchConfirmRequestId, "wms.outbound.packed");

  const notReadyPackingShipmentRequestId = requestId("ship-002-not-ready-packing");
  await expectWmsFailure(
    "POST",
    "/api/internal/wms/outbound/shipments",
    {
      packingId: mismatchPacking.data.packingId
    },
    notReadyPackingShipmentRequestId,
    {
      status: 422,
      code: "WMS_SHIPMENT_NOT_READY"
    }
  );
  await assertNoOutboxEvents(notReadyPackingShipmentRequestId, "wms.outbound.shipped");

  const duplicatePackingShipmentRequestId = requestId("ship-002-duplicate-packing");
  await expectWmsFailure(
    "POST",
    "/api/internal/wms/outbound/shipments",
    {
      packingId: shippedPackingId
    },
    duplicatePackingShipmentRequestId,
    {
      status: 409,
      code: "WMS_SHIPMENT_ALREADY_SHIPPED"
    }
  );
  await assertNoOutboxEvents(duplicatePackingShipmentRequestId, "wms.outbound.shipped");

  return [
    {
      scenarioId: "WMS-WH-001",
      result: "passed",
      evidence: `duplicateWarehouseStatus=409, code=WMS_WAREHOUSE_CODE_CONFLICT`
    },
    {
      scenarioId: "WMS-ITEM-001",
      result: "passed",
      evidence: `duplicateSkuStatus=409, code=WMS_ITEM_SKU_CONFLICT`
    },
    {
      scenarioId: "WMS-API-001",
      result: "passed",
      evidence: `missingTenant=TENANT_REQUIRED, invalidUuid=VALIDATION_FAILED`
    },
    {
      scenarioId: "WMS-INV-003",
      result: "passed",
      evidence: `negativeAdjustment=WMS_INSUFFICIENT_STOCK, outboxCount=0`
    },
    {
      scenarioId: "WMS-OUT-002",
      result: "passed",
      evidence: `insufficientAllocation=WMS_INSUFFICIENT_STOCK, outboxCount=0`
    },
    {
      scenarioId: "WMS-OUT-004",
      result: "passed",
      evidence: `duplicateShipment=WMS_OUTBOUND_ALLOCATION_NOT_ALLOCATED, outboxCount=0`
    },
    {
      scenarioId: "WMS-PACK-002",
      result: "passed",
      evidence: `quantityMismatch=WMS_PACKAGE_QUANTITY_MISMATCH, outboxCount=0`
    },
    {
      scenarioId: "WMS-SHIP-002",
      result: "passed",
      evidence: `notReady=WMS_SHIPMENT_NOT_READY, duplicatePackingShipment=WMS_SHIPMENT_ALREADY_SHIPPED, outboxCount=0`
    }
  ];
}

async function wmsRequest(method, path, body, requestId, options = {}) {
  const { response, payload } = await wmsRequestRaw(method, path, body, requestId, options);

  if (!response.ok || payload.success === false) {
    const code = payload.error?.code ?? response.status;
    const message = payload.error?.message ?? response.statusText;
    throw new Error(`${method} ${path} failed: ${code} ${message}`);
  }

  return payload;
}

async function wmsRequestRaw(method, path, body, requestId, options = {}) {
  const bodyText = body === undefined ? "" : JSON.stringify(body);
  const timestamp = new Date().toISOString();
  const signature = signInternalRequest(method, path, timestamp, requestId, bodyText);
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
    "X-Request-Id": requestId,
    "X-Internal-Service-Id": options.serviceId ?? "admin-bff-service",
    "X-Internal-Timestamp": timestamp,
    "X-Internal-Signature": signature
  };

  if (!options.omitTenant) {
    headers["X-Tenant-Id"] = options.tenantId ?? config.tenantId;
  }
  if (!options.omitUser) {
    headers["X-User-Id"] = options.userId ?? config.userId;
  }

  const response = await fetch(`${config.wmsBaseUrl}${path}`, {
    method,
    headers,
    body: bodyText || undefined
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};

  return { response, payload };
}

async function expectWmsFailure(method, path, body, requestId, expected, options = {}) {
  const { response, payload } = await wmsRequestRaw(method, path, body, requestId, options);
  assert(response.status === expected.status, `${method} ${path} expected ${expected.status}, got ${response.status}`);
  assert(payload.success === false, `${method} ${path} should return success=false`);
  assert(payload.requestId === requestId, `${method} ${path} should echo requestId`);
  assert(payload.timestamp, `${method} ${path} should include timestamp`);
  assert(payload.error?.code === expected.code, `${method} ${path} expected ${expected.code}, got ${payload.error?.code}`);
  return payload;
}

function assertPageEnvelope(value, label) {
  assert(value && typeof value === "object", `${label} should return data object`);
  assert(Array.isArray(value.items), `${label} should include data.items array`);
  assert(Number.isInteger(value.page), `${label} should include integer data.page`);
  assert(Number.isInteger(value.size), `${label} should include integer data.size`);
  assert(Number.isInteger(value.total), `${label} should include integer data.total`);
}

function assertDecimalEquals(value, expected, label) {
  const numeric = Number(value);
  assert(Number.isFinite(numeric), `${label} should be numeric, got ${value}`);
  assert(numeric === expected, `${label} expected ${expected}, got ${value}`);
}

async function waitForEventPublishedAndAudited(requestId, eventType) {
  const outboxRow = await waitForRow(
    () => queryJson(
      config.wmsDatabase,
      `SELECT event_id, event_type, status, published_target, retry_count, last_error FROM outbox_events WHERE request_id='${requestId}' AND event_type='${eventType}'`
    ),
    (row) => {
      if (row.status === "failed") {
        throw new Error(`WMS outbox event failed: ${row.last_error ?? "unknown"}`);
      }
      return row.status === "published";
    },
    `WMS outbox ${eventType} published`
  );

  await waitForRow(
    () => queryJson(
      config.auditDatabase,
      `SELECT audit_id, event_id, action, request_id FROM audit_logs WHERE event_id='${outboxRow.event_id}' AND action='${eventType}'`
    ),
    (row) => row.action === eventType,
    `audit log ${eventType} stored`
  );
}

function signInternalRequest(method, path, timestamp, requestId, bodyText) {
  const pathUrl = new URL(path, "http://wms.local");
  const originalUrl = `${pathUrl.pathname}${pathUrl.search}`;
  const bodyHash = createHash("sha256").update(bodyText).digest("hex");
  const payload = [method.toUpperCase(), originalUrl, timestamp, requestId, bodyHash].join("\n");

  return createHmac("sha256", config.wmsInternalSecret).update(payload).digest("hex");
}

async function ensureWmsSchema() {
  await run("pnpm", ["--filter", "wms-service", "exec", "prisma", "db", "push", "--schema", "prisma/schema.prisma", "--accept-data-loss"], {
    DATABASE_URL: config.wmsDatabaseUrl
  });
}

async function ensureAuditSchema() {
  await run("pnpm", ["--filter", "audit-log-service", "exec", "prisma", "db", "push", "--schema", "prisma/schema.prisma", "--accept-data-loss"], {
    DATABASE_URL: config.auditDatabaseUrl
  });
}

async function ensureAuthSeed() {
  await run("pnpm", ["--filter", "auth-iam-service", "prisma:seed"], {
    DATABASE_URL: config.authDatabaseUrl,
    LOCAL_SEED_TENANT_ID: config.tenantId
  });
}

async function createQueue() {
  const payload = await aws(["sqs", "create-queue", "--queue-name", config.queueName]);
  return JSON.parse(payload).QueueUrl;
}

async function purgeQueue(queueUrl) {
  try {
    await aws(["sqs", "purge-queue", "--queue-url", queueUrl]);
  } catch (error) {
    if (!String(error.message).includes("PurgeQueueInProgress")) {
      throw error;
    }
  }
}

async function pauseLocalOutboxRelayIfNeeded() {
  if (!config.pauseLocalOutboxRelay) {
    return undefined;
  }

  let running;
  try {
    running = (await run("docker", ["inspect", "-f", "{{.State.Running}}", config.localOutboxRelayContainer])).trim();
  } catch (error) {
    if (String(error.message).includes("No such object")) {
      return undefined;
    }
    throw error;
  }

  if (running !== "true") {
    return undefined;
  }

  const envText = await run("docker", [
    "inspect",
    "-f",
    "{{range .Config.Env}}{{println .}}{{end}}",
    config.localOutboxRelayContainer
  ]);
  const env = parseDockerEnv(envText);
  const sources = (env.OUTBOX_SOURCES ?? "").split(",").map((source) => source.trim());
  const workerEnabled = env.OUTBOX_WORKER_ENABLED !== "false";

  if (!workerEnabled || !sources.includes("wms")) {
    return undefined;
  }

  console.log(`Pausing ${config.localOutboxRelayContainer} while WMS verification owns WMS outbox events`);
  await run("docker", ["stop", config.localOutboxRelayContainer]);
  return config.localOutboxRelayContainer;
}

async function resumeLocalOutboxRelayIfNeeded(containerName) {
  if (!containerName) {
    return;
  }

  try {
    await run("docker", ["start", containerName]);
    console.log(`Resumed ${containerName}`);
  } catch (error) {
    console.warn(`Failed to resume ${containerName}: ${error.message}`);
  }
}

function parseDockerEnv(envText) {
  const env = {};
  for (const line of envText.split(/\r?\n/)) {
    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }
    env[line.slice(0, separatorIndex)] = line.slice(separatorIndex + 1);
  }
  return env;
}

async function ensureServiceReady(url, serviceName) {
  const deadline = Date.now() + 120_000;
  let lastError;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        const payload = await response.json();
        if (!payload.status || payload.status === "ready") {
          return;
        }
        lastError = new Error(`${serviceName} status is ${payload.status}`);
      } else {
        lastError = new Error(`${serviceName} returned ${response.status}`);
      }
    } catch (error) {
      lastError = error;
    }

    await sleep(2_000);
  }

  throw new Error(`Timed out waiting for ${serviceName}: ${lastError?.message ?? "unknown error"}`);
}

function ensureRequiredCommands() {
  for (const command of ["aws", "docker", "pnpm"]) {
    const result = spawnSync(command, ["--version"]);
    if (result.status !== 0) {
      throw new Error(`${command} is required for local WMS verification`);
    }
  }
}

async function ensureDockerDependencies() {
  const services = ["multi-tenant-postgres", "multi-tenant-localstack"];
  for (const service of services) {
    const result = await run("docker", ["inspect", "-f", "{{.State.Running}}", service]);
    if (result.trim() !== "true") {
      throw new Error(`${service} must be running. Run pnpm db:reset:local or start local compose first.`);
    }
  }
}

function startProcess(serviceName, env) {
  const child = spawn("pnpm", ["--filter", serviceName, "dev"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...env
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  children.push(child);
  child.stdout.on("data", (chunk) => process.stdout.write(prefixLines(serviceName, chunk)));
  child.stderr.on("data", (chunk) => process.stderr.write(prefixLines(serviceName, chunk)));
  child.on("exit", (code, signal) => {
    if (code !== null && code !== 0) {
      console.error(`${serviceName} exited with code ${code}`);
    }
    if (signal) {
      console.error(`${serviceName} exited with signal ${signal}`);
    }
  });

  return child;
}

async function waitForRow(query, predicate, description) {
  const deadline = Date.now() + 90_000;
  let lastRow;

  while (Date.now() < deadline) {
    const row = await query();
    if (row) {
      lastRow = row;
      if (predicate(row)) {
        return row;
      }
    }

    await sleep(1_000);
  }

  throw new Error(`Timed out waiting for ${description}. Last row: ${JSON.stringify(lastRow)}`);
}

async function queryJson(database, sql) {
  const wrapped = `SELECT COALESCE((SELECT row_to_json(row) FROM (${sql}) row LIMIT 1)::text, '')`;
  const output = await psql(database, wrapped);
  const text = output.trim();
  return text ? JSON.parse(text) : undefined;
}

async function assertNoOutboxEvents(requestId, eventType) {
  const eventFilter = eventType ? ` AND event_type='${escapeSqlLiteral(eventType)}'` : "";
  const output = await psql(
    config.wmsDatabase,
    `SELECT COUNT(*)::int FROM outbox_events WHERE request_id='${escapeSqlLiteral(requestId)}'${eventFilter}`
  );
  const count = Number(output.trim());
  assert(count === 0, `expected no outbox events for ${requestId}, got ${count}`);
}

function escapeSqlLiteral(value) {
  return String(value).replace(/'/g, "''");
}

function seoulBusinessDate(date = new Date()) {
  return new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function psql(database, sql) {
  return run("docker", [
    "exec",
    "-i",
    config.postgresContainer,
    "psql",
    "-U",
    "postgres",
    "-d",
    database,
    "-tA",
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    sql
  ]);
}

async function aws(args) {
  return run(
    "aws",
    ["--endpoint-url", config.localstackEndpoint, "--region", config.region, ...args],
    {
      AWS_ACCESS_KEY_ID: "test",
      AWS_SECRET_ACCESS_KEY: "test",
      AWS_DEFAULT_REGION: config.region
    }
  );
}

function run(command, args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...env
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }

      reject(new Error(`${command} ${args.join(" ")} failed with code ${code}\n${stderr || stdout}`));
    });
  });
}

function prefixLines(prefix, chunk) {
  return chunk
    .toString()
    .split(/\r?\n/)
    .map((line) => (line ? `[${prefix}] ${line}` : line))
    .join("\n");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function shutdown() {
  for (const child of children) {
    if (!child.killed) {
      child.kill();
    }
  }
}

process.on("SIGINT", () => {
  void shutdown().finally(() => process.exit(130));
});
process.on("SIGTERM", () => {
  void shutdown().finally(() => process.exit(143));
});

try {
  await main();
} finally {
  await shutdown();
}

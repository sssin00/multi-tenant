export interface PageResponse<T> {
  items: T[];
  page: number;
  size: number;
  total: number;
}

export interface WarehouseResponse {
  warehouseId: string;
  tenantId: string;
  code: string;
  name: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface LocationResponse {
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

export interface ItemResponse {
  itemId: string;
  tenantId: string;
  sku: string;
  name: string;
  uom: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface InventoryBalanceResponse {
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

export interface InventoryAdjustmentResponse {
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

export interface InventoryDailySnapshotResponse {
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

export interface InventorySnapshotRunResponse {
  runId: string;
  tenantId: string;
  snapshotDate: string;
  snapshotAt: string;
  warehouseId: string | null;
  mode: string;
  status: string;
  generatedCount: number;
  unchangedCount: number;
  errorCode: string | null;
  createdBy: string | null;
  requestId: string;
  startedAt: string;
  finishedAt: string | null;
}

export interface InboundReceiptResponse {
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

export interface OutboundAllocationResponse {
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

export interface OutboundPackingResponse {
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

export interface OutboundPackageItemResponse {
  packageItemId: string;
  allocationId: string;
  itemId: string;
  quantity: string;
  createdAt: string;
}

export interface OutboundPackageResponse {
  packageId: string;
  tenantId: string;
  packingId: string;
  packageNo: string;
  boxType: string | null;
  weight: string | null;
  width: string | null;
  height: string | null;
  depth: string | null;
  items: OutboundPackageItemResponse[];
  createdAt: string;
  updatedAt: string;
}

export interface OutboundShipmentResponse {
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

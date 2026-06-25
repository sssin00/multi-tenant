export interface ApiEnvelope<T> {
  success: boolean;
  requestId: string;
  timestamp: string;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface PageData<T> {
  items: T[];
  page: number;
  size: number;
  total: number;
}

export interface QuantityTotals {
  quantity: string;
  allocatedQuantity: string;
  availableQuantity: string;
}

export interface WmsDashboard {
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

export interface WarehouseItem {
  warehouseId: string;
  code: string;
  name: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface MaterialItem {
  materialId: string;
  code: string;
  name: string;
  uom: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface LocationItem {
  locationId: string;
  warehouseId: string;
  code: string;
  name: string | null;
  type: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface InventoryItem {
  balanceId: string;
  warehouseId: string;
  locationId: string;
  materialId: string;
  quantity: string;
  allocatedQuantity: string;
  availableQuantity: string;
  updatedAt: string;
}

export interface InventorySummary {
  pageTotals: QuantityTotals;
  inventory: PageData<InventoryItem>;
}

export interface InventorySnapshotItem {
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

export interface InventorySnapshots {
  pageTotals: QuantityTotals;
  snapshots: PageData<InventorySnapshotItem>;
}

export interface OutboundAllocationItem {
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

export interface OutboundPackingItem {
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

export interface InventoryAdjustmentResult {
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

export interface InboundConfirmationResult {
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

export interface OutboundPackageResult {
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

export interface OutboundShipmentResult {
  shipmentId?: string;
  allocationId?: string | null;
  packingId?: string | null;
  outboundOrderId: string;
  orderNo: string;
  warehouseId: string;
  carrierCode?: string | null;
  trackingNo?: string | null;
  shippedBy?: string | null;
  shippedAt: string;
  createdAt?: string;
  status?: string;
}

export interface AuthSession {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  refreshExpiresIn?: number;
  tokenType: "Bearer";
  tenantId: string;
  user: {
    userId: string;
    email: string;
    displayName: string;
  };
}

export interface AppMe {
  user: {
    userId: string;
  };
  tenant: {
    tenantId: string;
    code: string;
    name: string;
    status: string;
    enabledModules: string[];
  };
  permissions: {
    userId: string;
    tenantId: string;
    roles: Array<{
      roleId: string;
      roleCode: string;
      warehouseId: string | null;
    }>;
    permissions: string[];
  };
}

export interface AppNavigation {
  items: Array<{
    id: string;
    label: string;
    path: string;
    requiredPermissions: string[];
  }>;
}

export interface DataResult<T> {
  data: T;
  source: "api" | "sample";
  requestId?: string;
  message?: string;
}

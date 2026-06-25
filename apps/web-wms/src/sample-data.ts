import type {
  AuthSession,
  InventorySnapshots,
  InventorySummary,
  LocationItem,
  MaterialItem,
  OutboundAllocationItem,
  OutboundPackingItem,
  PageData,
  WarehouseItem,
  WmsDashboard
} from "./api-types";

export const sampleSession: AuthSession = {
  accessToken: "sample-access-token",
  refreshToken: "sample-refresh-token",
  tokenType: "Bearer",
  tenantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  user: {
    userId: "22222222-2222-4222-8222-222222222222",
    email: "operator@example.com",
    displayName: "창고 운영자"
  }
};

export const sampleDashboard: WmsDashboard = {
  inventory: {
    totalBalances: 128,
    sampledBalanceCount: 20,
    pageTotals: {
      quantity: "12840.000",
      allocatedQuantity: "2160.000",
      availableQuantity: "10680.000"
    }
  },
  operations: {
    outboundAllocations: {
      canView: true,
      total: 36,
      sampledCount: 20
    },
    outboundPackings: {
      canView: true,
      total: 18,
      sampledCount: 18
    }
  },
  visibleActions: {
    inventory: true,
    warehouses: true,
    materials: true,
    snapshots: false,
    packing: true,
    shipping: false
  }
};

export const sampleInventory: InventorySummary = {
  pageTotals: sampleDashboard.inventory.pageTotals,
  inventory: {
    page: 1,
    size: 20,
    total: 128,
    items: [
      {
        balanceId: "bal-001",
        warehouseId: "wh-seoul",
        locationId: "A-01-01",
        materialId: "MAT-1001",
        quantity: "420.000",
        allocatedQuantity: "80.000",
        availableQuantity: "340.000",
        updatedAt: "2026-06-22T00:00:00.000Z"
      },
      {
        balanceId: "bal-002",
        warehouseId: "wh-seoul",
        locationId: "B-02-03",
        materialId: "MAT-1002",
        quantity: "760.000",
        allocatedQuantity: "120.000",
        availableQuantity: "640.000",
        updatedAt: "2026-06-22T00:00:00.000Z"
      },
      {
        balanceId: "bal-003",
        warehouseId: "wh-busan",
        locationId: "C-01-02",
        materialId: "MAT-2001",
        quantity: "310.000",
        allocatedQuantity: "30.000",
        availableQuantity: "280.000",
        updatedAt: "2026-06-21T15:30:00.000Z"
      }
    ]
  }
};

export const sampleSnapshots: InventorySnapshots = {
  pageTotals: {
    quantity: "1490.000",
    allocatedQuantity: "230.000",
    availableQuantity: "1260.000"
  },
  snapshots: {
    page: 1,
    size: 20,
    total: 3,
    items: [
      {
        snapshotId: "snap-001",
        snapshotDate: "2026-06-22",
        snapshotAt: "2026-06-22T00:00:00.000Z",
        warehouseId: "wh-seoul",
        locationId: "A-01-01",
        materialId: "MAT-1001",
        quantity: "420.000",
        allocatedQuantity: "80.000",
        availableQuantity: "340.000",
        sourceLedgerId: null,
        runId: "run-20260622",
        previousSnapshotId: "snap-000",
        generatedAt: "2026-06-22T00:05:00.000Z"
      },
      {
        snapshotId: "snap-002",
        snapshotDate: "2026-06-22",
        snapshotAt: "2026-06-22T00:00:00.000Z",
        warehouseId: "wh-seoul",
        locationId: "B-02-03",
        materialId: "MAT-1002",
        quantity: "760.000",
        allocatedQuantity: "120.000",
        availableQuantity: "640.000",
        sourceLedgerId: null,
        runId: "run-20260622",
        previousSnapshotId: "snap-010",
        generatedAt: "2026-06-22T00:05:00.000Z"
      }
    ]
  }
};

export const sampleWarehouses: PageData<WarehouseItem> = {
  page: 1,
  size: 20,
  total: 2,
  items: [
    {
      warehouseId: "wh-seoul",
      code: "SEOUL-DC",
      name: "서울 물류센터",
      status: "active",
      createdAt: "2026-06-01T00:00:00.000Z",
      updatedAt: "2026-06-22T00:00:00.000Z"
    },
    {
      warehouseId: "wh-busan",
      code: "BUSAN-DC",
      name: "부산 허브",
      status: "active",
      createdAt: "2026-06-01T00:00:00.000Z",
      updatedAt: "2026-06-22T00:00:00.000Z"
    }
  ]
};

export const sampleLocations: PageData<LocationItem> = {
  page: 1,
  size: 20,
  total: 3,
  items: [
    {
      locationId: "A-01-01",
      warehouseId: "wh-seoul",
      code: "A-01-01",
      name: "A구역 01",
      type: "storage",
      status: "active",
      createdAt: "2026-06-01T00:00:00.000Z",
      updatedAt: "2026-06-22T00:00:00.000Z"
    },
    {
      locationId: "B-02-03",
      warehouseId: "wh-seoul",
      code: "B-02-03",
      name: "B구역 03",
      type: "picking",
      status: "active",
      createdAt: "2026-06-01T00:00:00.000Z",
      updatedAt: "2026-06-22T00:00:00.000Z"
    }
  ]
};

export const sampleMaterials: PageData<MaterialItem> = {
  page: 1,
  size: 20,
  total: 2,
  items: [
    {
      materialId: "MAT-1001",
      code: "MAT-1001",
      name: "테스트 자재 A",
      uom: "EA",
      status: "active",
      createdAt: "2026-06-01T00:00:00.000Z",
      updatedAt: "2026-06-22T00:00:00.000Z"
    },
    {
      materialId: "MAT-1002",
      code: "MAT-1002",
      name: "테스트 자재 B",
      uom: "BOX",
      status: "active",
      createdAt: "2026-06-01T00:00:00.000Z",
      updatedAt: "2026-06-22T00:00:00.000Z"
    }
  ]
};

export const sampleAllocations: PageData<OutboundAllocationItem> = {
  page: 1,
  size: 20,
  total: 2,
  items: [
    {
      allocationId: "alloc-001",
      outboundOrderId: "out-001",
      orderNo: "SO-20260622-001",
      warehouseId: "wh-seoul",
      locationId: "A-01-01",
      materialId: "MAT-1001",
      quantity: "80.000",
      status: "allocated",
      allocatedBy: "22222222-2222-4222-8222-222222222222",
      allocatedAt: "2026-06-22T01:00:00.000Z",
      shippedBy: null,
      shippedAt: null
    },
    {
      allocationId: "alloc-002",
      outboundOrderId: "out-002",
      orderNo: "SO-20260622-002",
      warehouseId: "wh-seoul",
      locationId: "B-02-03",
      materialId: "MAT-1002",
      quantity: "120.000",
      status: "allocated",
      allocatedBy: "22222222-2222-4222-8222-222222222222",
      allocatedAt: "2026-06-22T01:20:00.000Z",
      shippedBy: null,
      shippedAt: null
    }
  ]
};

export const samplePackings: PageData<OutboundPackingItem> = {
  page: 1,
  size: 20,
  total: 1,
  items: [
    {
      packingId: "pack-001",
      outboundOrderId: "out-001",
      orderNo: "SO-20260622-001",
      warehouseId: "wh-seoul",
      status: "confirmed",
      allocationIds: ["alloc-001"],
      packageIds: ["PKG-001", "PKG-002"],
      packageCount: 2,
      memo: "front packing list sample",
      packedBy: "22222222-2222-4222-8222-222222222222",
      confirmedBy: "22222222-2222-4222-8222-222222222222",
      confirmedAt: "2026-06-22T02:00:00.000Z",
      shippedAt: null,
      createdAt: "2026-06-22T01:30:00.000Z",
      updatedAt: "2026-06-22T02:00:00.000Z"
    }
  ]
};

CREATE TYPE "WarehouseStatus" AS ENUM ('active', 'inactive');
CREATE TYPE "LocationStatus" AS ENUM ('active', 'inactive');
CREATE TYPE "LocationType" AS ENUM ('storage', 'receiving', 'shipping', 'staging');
CREATE TYPE "ItemStatus" AS ENUM ('active', 'inactive');
CREATE TYPE "OutboundOrderStatus" AS ENUM ('draft', 'allocated', 'shipped', 'cancelled');
CREATE TYPE "OutboundAllocationStatus" AS ENUM ('allocated', 'shipped', 'cancelled');
CREATE TYPE "OutboxStatus" AS ENUM ('pending', 'published', 'failed');

CREATE TABLE "wms_warehouses" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "status" "WarehouseStatus" NOT NULL DEFAULT 'active',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "wms_warehouses_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "wms_locations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "warehouse_id" UUID NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT,
  "type" "LocationType" NOT NULL DEFAULT 'storage',
  "status" "LocationStatus" NOT NULL DEFAULT 'active',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "wms_locations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "wms_items" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "sku" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "uom" TEXT NOT NULL,
  "status" "ItemStatus" NOT NULL DEFAULT 'active',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "wms_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "wms_inventory_balances" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "warehouse_id" UUID NOT NULL,
  "location_id" UUID NOT NULL,
  "item_id" UUID NOT NULL,
  "quantity" DECIMAL(18,3) NOT NULL DEFAULT 0,
  "allocated_quantity" DECIMAL(18,3) NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "wms_inventory_balances_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "wms_inventory_adjustments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "warehouse_id" UUID NOT NULL,
  "location_id" UUID NOT NULL,
  "item_id" UUID NOT NULL,
  "quantity_change" DECIMAL(18,3) NOT NULL,
  "reason" TEXT NOT NULL,
  "reference_no" TEXT,
  "memo" TEXT,
  "adjusted_by" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "wms_inventory_adjustments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "wms_inbound_receipts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "warehouse_id" UUID NOT NULL,
  "location_id" UUID NOT NULL,
  "item_id" UUID NOT NULL,
  "quantity" DECIMAL(18,3) NOT NULL,
  "reference_no" TEXT,
  "confirmed_by" UUID,
  "confirmed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "wms_inbound_receipts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "wms_outbound_orders" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "warehouse_id" UUID NOT NULL,
  "order_no" TEXT NOT NULL,
  "status" "OutboundOrderStatus" NOT NULL DEFAULT 'draft',
  "shipped_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "wms_outbound_orders_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "wms_outbound_allocations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "outbound_order_id" UUID NOT NULL,
  "warehouse_id" UUID NOT NULL,
  "location_id" UUID NOT NULL,
  "item_id" UUID NOT NULL,
  "quantity" DECIMAL(18,3) NOT NULL,
  "status" "OutboundAllocationStatus" NOT NULL DEFAULT 'allocated',
  "allocated_by" UUID,
  "allocated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "shipped_by" UUID,
  "shipped_at" TIMESTAMPTZ(6),

  CONSTRAINT "wms_outbound_allocations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "outbox_events" (
  "outbox_id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "event_id" UUID NOT NULL,
  "event_type" TEXT NOT NULL,
  "schema_version" INTEGER NOT NULL,
  "tenant_id" UUID NOT NULL,
  "request_id" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "aggregate_type" TEXT NOT NULL,
  "aggregate_id" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" "OutboxStatus" NOT NULL DEFAULT 'pending',
  "retry_count" INTEGER NOT NULL DEFAULT 0,
  "locked_at" TIMESTAMPTZ(6),
  "locked_by" TEXT,
  "next_retry_at" TIMESTAMPTZ(6),
  "last_error" TEXT,
  "published_target" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "published_at" TIMESTAMPTZ(6),

  CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("outbox_id")
);

CREATE UNIQUE INDEX "wms_warehouses_tenant_id_code_key" ON "wms_warehouses"("tenant_id", "code");
CREATE INDEX "wms_warehouses_tenant_id_status_idx" ON "wms_warehouses"("tenant_id", "status");

CREATE UNIQUE INDEX "wms_locations_tenant_id_warehouse_id_code_key" ON "wms_locations"("tenant_id", "warehouse_id", "code");
CREATE INDEX "wms_locations_tenant_id_warehouse_id_idx" ON "wms_locations"("tenant_id", "warehouse_id");
CREATE INDEX "wms_locations_tenant_id_status_idx" ON "wms_locations"("tenant_id", "status");

CREATE UNIQUE INDEX "wms_items_tenant_id_sku_key" ON "wms_items"("tenant_id", "sku");
CREATE INDEX "wms_items_tenant_id_status_idx" ON "wms_items"("tenant_id", "status");

CREATE UNIQUE INDEX "wms_inventory_balances_tenant_id_warehouse_id_location_id_item_id_key"
  ON "wms_inventory_balances"("tenant_id", "warehouse_id", "location_id", "item_id");
CREATE INDEX "wms_inventory_balances_tenant_id_item_id_idx" ON "wms_inventory_balances"("tenant_id", "item_id");
CREATE INDEX "wms_inventory_balances_tenant_id_warehouse_id_item_id_idx"
  ON "wms_inventory_balances"("tenant_id", "warehouse_id", "item_id");

CREATE INDEX "wms_inventory_adjustments_tenant_id_item_id_created_at_idx"
  ON "wms_inventory_adjustments"("tenant_id", "item_id", "created_at");
CREATE INDEX "wms_inventory_adjustments_tenant_id_warehouse_id_location_id_idx"
  ON "wms_inventory_adjustments"("tenant_id", "warehouse_id", "location_id");

CREATE INDEX "wms_inbound_receipts_tenant_id_item_id_confirmed_at_idx"
  ON "wms_inbound_receipts"("tenant_id", "item_id", "confirmed_at");
CREATE INDEX "wms_inbound_receipts_tenant_id_warehouse_id_location_id_idx"
  ON "wms_inbound_receipts"("tenant_id", "warehouse_id", "location_id");

CREATE UNIQUE INDEX "wms_outbound_orders_tenant_id_order_no_key" ON "wms_outbound_orders"("tenant_id", "order_no");
CREATE INDEX "wms_outbound_orders_tenant_id_status_idx" ON "wms_outbound_orders"("tenant_id", "status");
CREATE INDEX "wms_outbound_orders_tenant_id_warehouse_id_idx" ON "wms_outbound_orders"("tenant_id", "warehouse_id");

CREATE INDEX "wms_outbound_allocations_tenant_id_outbound_order_id_idx"
  ON "wms_outbound_allocations"("tenant_id", "outbound_order_id");
CREATE INDEX "wms_outbound_allocations_tenant_id_status_idx"
  ON "wms_outbound_allocations"("tenant_id", "status");
CREATE INDEX "wms_outbound_allocations_tenant_id_item_id_idx"
  ON "wms_outbound_allocations"("tenant_id", "item_id");

CREATE UNIQUE INDEX "outbox_events_event_id_key" ON "outbox_events"("event_id");
CREATE INDEX "outbox_events_status_created_at_idx" ON "outbox_events"("status", "created_at");
CREATE INDEX "outbox_events_status_next_retry_at_created_at_idx" ON "outbox_events"("status", "next_retry_at", "created_at");
CREATE INDEX "outbox_events_locked_at_idx" ON "outbox_events"("locked_at");
CREATE INDEX "outbox_events_tenant_id_event_type_idx" ON "outbox_events"("tenant_id", "event_type");
CREATE INDEX "outbox_events_aggregate_type_aggregate_id_idx" ON "outbox_events"("aggregate_type", "aggregate_id");

ALTER TABLE "wms_locations"
  ADD CONSTRAINT "wms_locations_warehouse_id_fkey"
  FOREIGN KEY ("warehouse_id") REFERENCES "wms_warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "wms_inventory_balances"
  ADD CONSTRAINT "wms_inventory_balances_warehouse_id_fkey"
  FOREIGN KEY ("warehouse_id") REFERENCES "wms_warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wms_inventory_balances"
  ADD CONSTRAINT "wms_inventory_balances_location_id_fkey"
  FOREIGN KEY ("location_id") REFERENCES "wms_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wms_inventory_balances"
  ADD CONSTRAINT "wms_inventory_balances_item_id_fkey"
  FOREIGN KEY ("item_id") REFERENCES "wms_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "wms_inventory_adjustments"
  ADD CONSTRAINT "wms_inventory_adjustments_warehouse_id_fkey"
  FOREIGN KEY ("warehouse_id") REFERENCES "wms_warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wms_inventory_adjustments"
  ADD CONSTRAINT "wms_inventory_adjustments_location_id_fkey"
  FOREIGN KEY ("location_id") REFERENCES "wms_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wms_inventory_adjustments"
  ADD CONSTRAINT "wms_inventory_adjustments_item_id_fkey"
  FOREIGN KEY ("item_id") REFERENCES "wms_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "wms_inbound_receipts"
  ADD CONSTRAINT "wms_inbound_receipts_warehouse_id_fkey"
  FOREIGN KEY ("warehouse_id") REFERENCES "wms_warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wms_inbound_receipts"
  ADD CONSTRAINT "wms_inbound_receipts_location_id_fkey"
  FOREIGN KEY ("location_id") REFERENCES "wms_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wms_inbound_receipts"
  ADD CONSTRAINT "wms_inbound_receipts_item_id_fkey"
  FOREIGN KEY ("item_id") REFERENCES "wms_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "wms_outbound_orders"
  ADD CONSTRAINT "wms_outbound_orders_warehouse_id_fkey"
  FOREIGN KEY ("warehouse_id") REFERENCES "wms_warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "wms_outbound_allocations"
  ADD CONSTRAINT "wms_outbound_allocations_outbound_order_id_fkey"
  FOREIGN KEY ("outbound_order_id") REFERENCES "wms_outbound_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wms_outbound_allocations"
  ADD CONSTRAINT "wms_outbound_allocations_warehouse_id_fkey"
  FOREIGN KEY ("warehouse_id") REFERENCES "wms_warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wms_outbound_allocations"
  ADD CONSTRAINT "wms_outbound_allocations_location_id_fkey"
  FOREIGN KEY ("location_id") REFERENCES "wms_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wms_outbound_allocations"
  ADD CONSTRAINT "wms_outbound_allocations_item_id_fkey"
  FOREIGN KEY ("item_id") REFERENCES "wms_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TYPE "InventoryLedgerMovementType" AS ENUM ('baseline', 'adjustment', 'inbound', 'allocation', 'shipment', 'correction');
CREATE TYPE "InventoryLedgerSourceType" AS ENUM ('baseline', 'inventory_adjustment', 'inbound_receipt', 'outbound_allocation', 'outbound_shipment');
CREATE TYPE "InventorySnapshotRunMode" AS ENUM ('generate', 'rebuild');
CREATE TYPE "InventorySnapshotRunStatus" AS ENUM ('running', 'completed', 'failed');

ALTER TABLE "wms_inventory_adjustments"
  ADD COLUMN "effective_date" DATE DEFAULT ((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul')::date);
ALTER TABLE "wms_inventory_adjustments"
  ADD COLUMN "corrected_ledger_id" UUID;
ALTER TABLE "wms_inventory_adjustments"
  ADD COLUMN "correction_reason" TEXT;
UPDATE "wms_inventory_adjustments"
  SET "effective_date" = ("created_at" AT TIME ZONE 'Asia/Seoul')::date
  WHERE "effective_date" IS NULL;
ALTER TABLE "wms_inventory_adjustments"
  ALTER COLUMN "effective_date" SET NOT NULL;

CREATE TABLE "wms_inventory_ledger" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "warehouse_id" UUID NOT NULL,
  "location_id" UUID NOT NULL,
  "item_id" UUID NOT NULL,
  "movement_type" "InventoryLedgerMovementType" NOT NULL,
  "source_type" "InventoryLedgerSourceType" NOT NULL,
  "source_id" UUID,
  "quantity_change" DECIMAL(18,3) NOT NULL,
  "allocated_quantity_change" DECIMAL(18,3) NOT NULL,
  "balance_quantity_after" DECIMAL(18,3) NOT NULL,
  "balance_allocated_quantity_after" DECIMAL(18,3) NOT NULL,
  "effective_date" DATE NOT NULL,
  "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "corrected_ledger_id" UUID,
  "correction_reason" TEXT,
  "request_id" TEXT NOT NULL,

  CONSTRAINT "wms_inventory_ledger_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "wms_inventory_snapshot_runs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "snapshot_date" DATE NOT NULL,
  "snapshot_at" TIMESTAMPTZ(6) NOT NULL,
  "warehouse_id" UUID,
  "mode" "InventorySnapshotRunMode" NOT NULL,
  "status" "InventorySnapshotRunStatus" NOT NULL DEFAULT 'running',
  "generated_count" INTEGER NOT NULL DEFAULT 0,
  "unchanged_count" INTEGER NOT NULL DEFAULT 0,
  "error_code" TEXT,
  "created_by" UUID,
  "request_id" TEXT NOT NULL,
  "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finished_at" TIMESTAMPTZ(6),

  CONSTRAINT "wms_inventory_snapshot_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "wms_inventory_daily_snapshots" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "snapshot_date" DATE NOT NULL,
  "snapshot_at" TIMESTAMPTZ(6) NOT NULL,
  "warehouse_id" UUID NOT NULL,
  "location_id" UUID NOT NULL,
  "item_id" UUID NOT NULL,
  "quantity" DECIMAL(18,3) NOT NULL,
  "allocated_quantity" DECIMAL(18,3) NOT NULL,
  "available_quantity" DECIMAL(18,3) NOT NULL,
  "source_ledger_id" UUID,
  "run_id" UUID NOT NULL,
  "previous_snapshot_id" UUID,
  "is_current" BOOLEAN NOT NULL DEFAULT true,
  "generated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "wms_inventory_daily_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "wms_inventory_ledger_tenant_id_effective_date_warehouse_id_location_id_item_id_idx"
  ON "wms_inventory_ledger"("tenant_id", "effective_date", "warehouse_id", "location_id", "item_id");
CREATE INDEX "wms_inventory_ledger_tenant_id_occurred_at_idx"
  ON "wms_inventory_ledger"("tenant_id", "occurred_at");
CREATE INDEX "wms_inventory_ledger_tenant_id_source_type_source_id_idx"
  ON "wms_inventory_ledger"("tenant_id", "source_type", "source_id");
CREATE INDEX "wms_inventory_ledger_tenant_id_corrected_ledger_id_idx"
  ON "wms_inventory_ledger"("tenant_id", "corrected_ledger_id");

CREATE INDEX "wms_inventory_snapshot_runs_tenant_id_snapshot_date_status_idx"
  ON "wms_inventory_snapshot_runs"("tenant_id", "snapshot_date", "status");
CREATE INDEX "wms_inventory_snapshot_runs_tenant_id_warehouse_id_snapshot_date_idx"
  ON "wms_inventory_snapshot_runs"("tenant_id", "warehouse_id", "snapshot_date");

CREATE UNIQUE INDEX "wms_inventory_daily_snapshots_tenant_id_snapshot_date_warehouse_id_location_id_item_id_run_id_key"
  ON "wms_inventory_daily_snapshots"("tenant_id", "snapshot_date", "warehouse_id", "location_id", "item_id", "run_id");
CREATE INDEX "wms_inventory_daily_snapshots_tenant_id_snapshot_date_is_current_idx"
  ON "wms_inventory_daily_snapshots"("tenant_id", "snapshot_date", "is_current");
CREATE INDEX "wms_inventory_daily_snapshots_tenant_id_warehouse_id_snapshot_date_idx"
  ON "wms_inventory_daily_snapshots"("tenant_id", "warehouse_id", "snapshot_date");
CREATE INDEX "wms_inventory_daily_snapshots_tenant_id_item_id_snapshot_date_idx"
  ON "wms_inventory_daily_snapshots"("tenant_id", "item_id", "snapshot_date");
CREATE INDEX "wms_inventory_daily_snapshots_tenant_id_previous_snapshot_id_idx"
  ON "wms_inventory_daily_snapshots"("tenant_id", "previous_snapshot_id");

ALTER TABLE "wms_inventory_ledger"
  ADD CONSTRAINT "wms_inventory_ledger_warehouse_id_fkey"
  FOREIGN KEY ("warehouse_id") REFERENCES "wms_warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wms_inventory_ledger"
  ADD CONSTRAINT "wms_inventory_ledger_location_id_fkey"
  FOREIGN KEY ("location_id") REFERENCES "wms_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wms_inventory_ledger"
  ADD CONSTRAINT "wms_inventory_ledger_item_id_fkey"
  FOREIGN KEY ("item_id") REFERENCES "wms_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wms_inventory_ledger"
  ADD CONSTRAINT "wms_inventory_ledger_corrected_ledger_id_fkey"
  FOREIGN KEY ("corrected_ledger_id") REFERENCES "wms_inventory_ledger"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "wms_inventory_daily_snapshots"
  ADD CONSTRAINT "wms_inventory_daily_snapshots_warehouse_id_fkey"
  FOREIGN KEY ("warehouse_id") REFERENCES "wms_warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wms_inventory_daily_snapshots"
  ADD CONSTRAINT "wms_inventory_daily_snapshots_location_id_fkey"
  FOREIGN KEY ("location_id") REFERENCES "wms_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wms_inventory_daily_snapshots"
  ADD CONSTRAINT "wms_inventory_daily_snapshots_item_id_fkey"
  FOREIGN KEY ("item_id") REFERENCES "wms_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wms_inventory_daily_snapshots"
  ADD CONSTRAINT "wms_inventory_daily_snapshots_source_ledger_id_fkey"
  FOREIGN KEY ("source_ledger_id") REFERENCES "wms_inventory_ledger"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "wms_inventory_daily_snapshots"
  ADD CONSTRAINT "wms_inventory_daily_snapshots_run_id_fkey"
  FOREIGN KEY ("run_id") REFERENCES "wms_inventory_snapshot_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wms_inventory_daily_snapshots"
  ADD CONSTRAINT "wms_inventory_daily_snapshots_previous_snapshot_id_fkey"
  FOREIGN KEY ("previous_snapshot_id") REFERENCES "wms_inventory_daily_snapshots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "wms_inventory_ledger" (
  "tenant_id",
  "warehouse_id",
  "location_id",
  "item_id",
  "movement_type",
  "source_type",
  "quantity_change",
  "allocated_quantity_change",
  "balance_quantity_after",
  "balance_allocated_quantity_after",
  "effective_date",
  "request_id"
)
SELECT
  "tenant_id",
  "warehouse_id",
  "location_id",
  "item_id",
  'baseline'::"InventoryLedgerMovementType",
  'baseline'::"InventoryLedgerSourceType",
  "quantity",
  "allocated_quantity",
  "quantity",
  "allocated_quantity",
  (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul')::date,
  'migration-baseline'
FROM "wms_inventory_balances";

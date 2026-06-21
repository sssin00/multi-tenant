CREATE TYPE "OutboundPackingStatus" AS ENUM ('packing', 'confirmed', 'shipped', 'cancelled');

CREATE TABLE "wms_outbound_packings" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "outbound_order_id" UUID NOT NULL,
  "warehouse_id" UUID NOT NULL,
  "status" "OutboundPackingStatus" NOT NULL DEFAULT 'packing',
  "memo" TEXT,
  "packed_by" UUID,
  "confirmed_by" UUID,
  "confirmed_at" TIMESTAMPTZ(6),
  "shipped_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "wms_outbound_packings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "wms_outbound_packing_allocations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "packing_id" UUID NOT NULL,
  "allocation_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "wms_outbound_packing_allocations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "wms_outbound_packages" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "packing_id" UUID NOT NULL,
  "package_no" TEXT NOT NULL,
  "box_type" TEXT,
  "weight" DECIMAL(18,3),
  "width" DECIMAL(18,3),
  "height" DECIMAL(18,3),
  "depth" DECIMAL(18,3),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "wms_outbound_packages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "wms_outbound_package_items" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "package_id" UUID NOT NULL,
  "allocation_id" UUID NOT NULL,
  "item_id" UUID NOT NULL,
  "quantity" DECIMAL(18,3) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "wms_outbound_package_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "wms_outbound_shipments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "packing_id" UUID,
  "allocation_id" UUID,
  "outbound_order_id" UUID NOT NULL,
  "warehouse_id" UUID NOT NULL,
  "carrier_code" TEXT,
  "tracking_no" TEXT,
  "shipped_by" UUID,
  "shipped_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "wms_outbound_shipments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "wms_outbound_packings_tenant_id_outbound_order_id_idx"
  ON "wms_outbound_packings"("tenant_id", "outbound_order_id");
CREATE INDEX "wms_outbound_packings_tenant_id_status_idx"
  ON "wms_outbound_packings"("tenant_id", "status");
CREATE INDEX "wms_outbound_packings_tenant_id_warehouse_id_idx"
  ON "wms_outbound_packings"("tenant_id", "warehouse_id");

CREATE UNIQUE INDEX "wms_outbound_packing_allocations_tenant_id_packing_id_allocation_id_key"
  ON "wms_outbound_packing_allocations"("tenant_id", "packing_id", "allocation_id");
CREATE UNIQUE INDEX "wms_outbound_packing_allocations_tenant_id_allocation_id_key"
  ON "wms_outbound_packing_allocations"("tenant_id", "allocation_id");
CREATE INDEX "wms_outbound_packing_allocations_tenant_id_packing_id_idx"
  ON "wms_outbound_packing_allocations"("tenant_id", "packing_id");

CREATE UNIQUE INDEX "wms_outbound_packages_tenant_id_packing_id_package_no_key"
  ON "wms_outbound_packages"("tenant_id", "packing_id", "package_no");
CREATE INDEX "wms_outbound_packages_tenant_id_packing_id_idx"
  ON "wms_outbound_packages"("tenant_id", "packing_id");

CREATE INDEX "wms_outbound_package_items_tenant_id_package_id_idx"
  ON "wms_outbound_package_items"("tenant_id", "package_id");
CREATE INDEX "wms_outbound_package_items_tenant_id_allocation_id_idx"
  ON "wms_outbound_package_items"("tenant_id", "allocation_id");
CREATE INDEX "wms_outbound_package_items_tenant_id_item_id_idx"
  ON "wms_outbound_package_items"("tenant_id", "item_id");

CREATE INDEX "wms_outbound_shipments_tenant_id_outbound_order_id_idx"
  ON "wms_outbound_shipments"("tenant_id", "outbound_order_id");
CREATE INDEX "wms_outbound_shipments_tenant_id_packing_id_idx"
  ON "wms_outbound_shipments"("tenant_id", "packing_id");
CREATE INDEX "wms_outbound_shipments_tenant_id_allocation_id_idx"
  ON "wms_outbound_shipments"("tenant_id", "allocation_id");
CREATE INDEX "wms_outbound_shipments_tenant_id_tracking_no_idx"
  ON "wms_outbound_shipments"("tenant_id", "tracking_no");

ALTER TABLE "wms_outbound_packings"
  ADD CONSTRAINT "wms_outbound_packings_outbound_order_id_fkey"
  FOREIGN KEY ("outbound_order_id") REFERENCES "wms_outbound_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wms_outbound_packings"
  ADD CONSTRAINT "wms_outbound_packings_warehouse_id_fkey"
  FOREIGN KEY ("warehouse_id") REFERENCES "wms_warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "wms_outbound_packing_allocations"
  ADD CONSTRAINT "wms_outbound_packing_allocations_packing_id_fkey"
  FOREIGN KEY ("packing_id") REFERENCES "wms_outbound_packings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wms_outbound_packing_allocations"
  ADD CONSTRAINT "wms_outbound_packing_allocations_allocation_id_fkey"
  FOREIGN KEY ("allocation_id") REFERENCES "wms_outbound_allocations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "wms_outbound_packages"
  ADD CONSTRAINT "wms_outbound_packages_packing_id_fkey"
  FOREIGN KEY ("packing_id") REFERENCES "wms_outbound_packings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "wms_outbound_package_items"
  ADD CONSTRAINT "wms_outbound_package_items_package_id_fkey"
  FOREIGN KEY ("package_id") REFERENCES "wms_outbound_packages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wms_outbound_package_items"
  ADD CONSTRAINT "wms_outbound_package_items_allocation_id_fkey"
  FOREIGN KEY ("allocation_id") REFERENCES "wms_outbound_allocations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wms_outbound_package_items"
  ADD CONSTRAINT "wms_outbound_package_items_item_id_fkey"
  FOREIGN KEY ("item_id") REFERENCES "wms_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "wms_outbound_shipments"
  ADD CONSTRAINT "wms_outbound_shipments_packing_id_fkey"
  FOREIGN KEY ("packing_id") REFERENCES "wms_outbound_packings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wms_outbound_shipments"
  ADD CONSTRAINT "wms_outbound_shipments_allocation_id_fkey"
  FOREIGN KEY ("allocation_id") REFERENCES "wms_outbound_allocations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wms_outbound_shipments"
  ADD CONSTRAINT "wms_outbound_shipments_outbound_order_id_fkey"
  FOREIGN KEY ("outbound_order_id") REFERENCES "wms_outbound_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wms_outbound_shipments"
  ADD CONSTRAINT "wms_outbound_shipments_warehouse_id_fkey"
  FOREIGN KEY ("warehouse_id") REFERENCES "wms_warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

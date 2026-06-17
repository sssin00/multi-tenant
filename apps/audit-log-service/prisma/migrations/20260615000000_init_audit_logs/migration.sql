-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "AuditActorType" AS ENUM ('user', 'system', 'service');

-- CreateEnum
CREATE TYPE "AuditResult" AS ENUM ('success', 'failure');

-- CreateTable
CREATE TABLE "audit_logs" (
    "audit_id" UUID NOT NULL,
    "event_id" UUID,
    "tenant_id" UUID NOT NULL,
    "request_id" TEXT NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "actor_type" "AuditActorType" NOT NULL,
    "actor_id" TEXT,
    "action" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" TEXT,
    "result" "AuditResult" NOT NULL,
    "reason" TEXT,
    "details" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("audit_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "audit_logs_event_id_key" ON "audit_logs"("event_id");

-- CreateIndex
CREATE INDEX "audit_logs_tenant_id_occurred_at_created_at_idx" ON "audit_logs"("tenant_id", "occurred_at" DESC, "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_tenant_id_action_occurred_at_idx" ON "audit_logs"("tenant_id", "action", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_tenant_id_actor_type_actor_id_occurred_at_idx" ON "audit_logs"("tenant_id", "actor_type", "actor_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_tenant_id_resource_type_resource_id_occurred_at_idx" ON "audit_logs"("tenant_id", "resource_type", "resource_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_tenant_id_result_occurred_at_idx" ON "audit_logs"("tenant_id", "result", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_request_id_idx" ON "audit_logs"("request_id");

-- CreateIndex
CREATE INDEX "audit_logs_tenant_id_event_id_idx" ON "audit_logs"("tenant_id", "event_id");

-- ─── Backfill isBankAccount on existing accounts ─────────────────────────────
-- Accounts with subType matching "Bank" or "Cash" (case-insensitive), or names
-- starting with "Cash" or "Bank", get flagged as bank accounts so existing
-- entities can pick them in Bank Recon without manual edits.
UPDATE "accounts"
SET "isBankAccount" = true
WHERE "isBankAccount" = false
  AND (
       lower(coalesce("subType", '')) IN ('bank', 'cash', 'cash and cash equivalents')
    OR lower("name") LIKE 'cash%'
    OR lower("name") LIKE 'bank%'
  )
  AND "type" = 'ASSET';

-- ─── Vendor Reconciliation ───────────────────────────────────────────────────
CREATE TYPE "VendorReconStatus" AS ENUM ('DRAFT', 'FINALIZED');

CREATE TABLE "vendor_reconciliations" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "vendor" TEXT NOT NULL,
    "statementDate" TIMESTAMP(3) NOT NULL,
    "statementBalance" DECIMAL(18,2) NOT NULL,
    "internalBalance" DECIMAL(18,2) NOT NULL,
    "difference" DECIMAL(18,2) NOT NULL,
    "status" "VendorReconStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "finalizedAt" TIMESTAMP(3),
    "finalizedBy" TEXT,

    CONSTRAINT "vendor_reconciliations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "vendor_reconciliations_entityId_statementDate_idx" ON "vendor_reconciliations"("entityId", "statementDate");
CREATE INDEX "vendor_reconciliations_entityId_vendor_idx" ON "vendor_reconciliations"("entityId", "vendor");

ALTER TABLE "vendor_reconciliations" ADD CONSTRAINT "vendor_reconciliations_entityId_fkey"
  FOREIGN KEY ("entityId") REFERENCES "legal_entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

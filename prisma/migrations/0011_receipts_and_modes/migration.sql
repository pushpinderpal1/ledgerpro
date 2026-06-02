-- New enums
CREATE TYPE "PaymentModeKind" AS ENUM ('PAYMENT', 'RECEIPT', 'BOTH');
CREATE TYPE "ReceiptStatus"   AS ENUM ('POSTED', 'VOID');

-- ─── Configurable payment-method catalog ────────────────────────────────────
CREATE TABLE "payment_modes" (
  "id"        TEXT NOT NULL,
  "entityId"  TEXT NOT NULL,
  "name"      TEXT NOT NULL,
  "code"      TEXT NOT NULL,
  "kind"      "PaymentModeKind" NOT NULL DEFAULT 'BOTH',
  "isActive"  BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "payment_modes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "payment_modes_entityId_code_key" ON "payment_modes"("entityId", "code");
CREATE INDEX "payment_modes_entityId_idx" ON "payment_modes"("entityId");

ALTER TABLE "payment_modes" ADD CONSTRAINT "payment_modes_entityId_fkey"
  FOREIGN KEY ("entityId") REFERENCES "legal_entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── Receipts (incoming money — counterpart to AP Payments) ──────────────────
CREATE TABLE "receipts" (
  "id"                  TEXT NOT NULL,
  "entityId"            TEXT NOT NULL,
  "receiptNo"           TEXT NOT NULL,
  "receivedFrom"        TEXT NOT NULL,
  "receiptDate"         TIMESTAMP(3) NOT NULL,
  "amount"              DECIMAL(18,2) NOT NULL,
  "paymentModeId"       TEXT NOT NULL,
  "reference"           TEXT,
  "description"         TEXT,
  "depositAccountId"    TEXT NOT NULL,
  "creditAccountId"     TEXT NOT NULL,
  "status"              "ReceiptStatus" NOT NULL DEFAULT 'POSTED',
  "voidedAt"            TIMESTAMP(3),
  "voidedBy"            TEXT,
  "journalEntryId"      TEXT,
  "voidJournalEntryId"  TEXT,
  "createdBy"           TEXT,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP(3) NOT NULL,

  CONSTRAINT "receipts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "receipts_entityId_receiptNo_key" ON "receipts"("entityId", "receiptNo");
CREATE UNIQUE INDEX "receipts_journalEntryId_key"      ON "receipts"("journalEntryId");
CREATE UNIQUE INDEX "receipts_voidJournalEntryId_key"  ON "receipts"("voidJournalEntryId");
CREATE INDEX "receipts_entityId_status_idx"      ON "receipts"("entityId", "status");
CREATE INDEX "receipts_entityId_receiptDate_idx" ON "receipts"("entityId", "receiptDate");

ALTER TABLE "receipts" ADD CONSTRAINT "receipts_entityId_fkey"
  FOREIGN KEY ("entityId") REFERENCES "legal_entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_paymentModeId_fkey"
  FOREIGN KEY ("paymentModeId") REFERENCES "payment_modes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_depositAccountId_fkey"
  FOREIGN KEY ("depositAccountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_creditAccountId_fkey"
  FOREIGN KEY ("creditAccountId")  REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_journalEntryId_fkey"
  FOREIGN KEY ("journalEntryId")      REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_voidJournalEntryId_fkey"
  FOREIGN KEY ("voidJournalEntryId")  REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Add MIS configuration columns to legal_entities (all additive, safe defaults)
ALTER TABLE "legal_entities"
  ADD COLUMN "misEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "misRequiredForTypes" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "misAllowOverride" BOOLEAN NOT NULL DEFAULT false;

-- New table: mis_codes
CREATE TABLE "mis_codes" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mis_codes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "mis_codes_entityId_code_key" ON "mis_codes"("entityId", "code");
CREATE INDEX "mis_codes_entityId_isActive_idx" ON "mis_codes"("entityId", "isActive");

ALTER TABLE "mis_codes" ADD CONSTRAINT "mis_codes_entityId_fkey"
  FOREIGN KEY ("entityId") REFERENCES "legal_entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Add misCodeId to journal_lines (nullable, no historical data migration needed)
ALTER TABLE "journal_lines"
  ADD COLUMN "misCodeId" TEXT;

CREATE INDEX "journal_lines_misCodeId_idx" ON "journal_lines"("misCodeId");

ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_misCodeId_fkey"
  FOREIGN KEY ("misCodeId") REFERENCES "mis_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

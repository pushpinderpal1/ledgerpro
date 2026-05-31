-- CreateEnum
CREATE TYPE "EntityType" AS ENUM ('STANDALONE', 'HOLDING', 'SUBSIDIARY', 'BRANCH');

-- Add group-structure columns to legal_entities (additive, defaults safe)
ALTER TABLE "legal_entities"
  ADD COLUMN "parentEntityId" TEXT,
  ADD COLUMN "ownershipPercent" DECIMAL(7,4) NOT NULL DEFAULT 100,
  ADD COLUMN "acquisitionDate" TIMESTAMP(3),
  ADD COLUMN "entityType" "EntityType" NOT NULL DEFAULT 'STANDALONE';

-- Self-referencing FK with SET NULL on parent delete (don't cascade — preserve children)
ALTER TABLE "legal_entities" ADD CONSTRAINT "legal_entities_parentEntityId_fkey"
  FOREIGN KEY ("parentEntityId") REFERENCES "legal_entities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "legal_entities_parentEntityId_idx" ON "legal_entities"("parentEntityId");

-- FX Rates
CREATE TABLE "fx_rates" (
    "id" TEXT NOT NULL,
    "fromCurrency" TEXT NOT NULL,
    "toCurrency" TEXT NOT NULL,
    "rate" DECIMAL(18,8) NOT NULL,
    "effectiveDate" TIMESTAMP(3) NOT NULL,
    "source" TEXT,
    "notes" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fx_rates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fx_rates_fromCurrency_toCurrency_effectiveDate_key"
  ON "fx_rates"("fromCurrency", "toCurrency", "effectiveDate");

CREATE INDEX "fx_rates_fromCurrency_toCurrency_idx" ON "fx_rates"("fromCurrency", "toCurrency");

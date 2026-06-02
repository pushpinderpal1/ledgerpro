-- Add openingBalance to accounts
ALTER TABLE "accounts" ADD COLUMN "openingBalance" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- Add openingDate to legal_entities (optional; defaults to Jan 1 current year if not set when needed)
ALTER TABLE "legal_entities" ADD COLUMN "openingDate" TIMESTAMP(3);

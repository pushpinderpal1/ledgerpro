-- ─── Enums ───────────────────────────────────────────────────────────────────
CREATE TYPE "VendorStatus"    AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'INACTIVE');
CREATE TYPE "VendorFrequency" AS ENUM ('ON_DEMAND', 'DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'SEMI_ANNUAL', 'ANNUAL', 'STATUTORY', 'ONE_TIME', 'OTHER');

-- ─── Vendor master ───────────────────────────────────────────────────────────
CREATE TABLE "vendors" (
  "id"               TEXT NOT NULL,
  "entityId"         TEXT NOT NULL,
  "vendorNumber"     TEXT,
  "legalName"        TEXT NOT NULL,
  "displayName"      TEXT,
  "contactPerson"    TEXT,
  "email"            TEXT,
  "phone"            TEXT,
  "website"          TEXT,
  "addressLine1"     TEXT,
  "addressLine2"     TEXT,
  "city"             TEXT,
  "state"            TEXT,
  "postalCode"       TEXT,
  "country"          TEXT,
  "taxId"            TEXT,
  "taxIdType"        TEXT,
  "is1099Vendor"     BOOLEAN NOT NULL DEFAULT false,
  "taxResidency"     TEXT,
  "paymentTerms"     TEXT,
  "currency"         TEXT NOT NULL DEFAULT 'USD',
  "creditLimit"      DECIMAL(18,2),
  "defaultAccountId" TEXT,
  "bankName"         TEXT,
  "bankAccountName"  TEXT,
  "bankAccountNumber" TEXT,
  "bankRoutingNumber" TEXT,
  "bankSwiftBic"     TEXT,
  "bankIban"         TEXT,
  "status"           "VendorStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
  "submittedBy"      TEXT,
  "submittedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "approvedBy"       TEXT,
  "approvedAt"       TIMESTAMP(3),
  "rejectedBy"       TEXT,
  "rejectedAt"       TIMESTAMP(3),
  "rejectionReason"  TEXT,
  "notes"            TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,

  CONSTRAINT "vendors_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "vendors_entityId_vendorNumber_key" ON "vendors"("entityId", "vendorNumber");
CREATE INDEX "vendors_entityId_status_idx"    ON "vendors"("entityId", "status");
CREATE INDEX "vendors_entityId_legalName_idx" ON "vendors"("entityId", "legalName");

ALTER TABLE "vendors" ADD CONSTRAINT "vendors_entityId_fkey"
  FOREIGN KEY ("entityId") REFERENCES "legal_entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_defaultAccountId_fkey"
  FOREIGN KEY ("defaultAccountId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── Vendor services ─────────────────────────────────────────────────────────
CREATE TABLE "vendor_services" (
  "id"               TEXT NOT NULL,
  "vendorId"         TEXT NOT NULL,
  "serviceName"      TEXT NOT NULL,
  "frequency"        "VendorFrequency" NOT NULL,
  "defaultAccountId" TEXT,
  "estimatedAmount"  DECIMAL(18,2),
  "notes"            TEXT,
  "isActive"         BOOLEAN NOT NULL DEFAULT true,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,

  CONSTRAINT "vendor_services_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "vendor_services_vendorId_idx" ON "vendor_services"("vendorId");

ALTER TABLE "vendor_services" ADD CONSTRAINT "vendor_services_vendorId_fkey"
  FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "vendor_services" ADD CONSTRAINT "vendor_services_defaultAccountId_fkey"
  FOREIGN KEY ("defaultAccountId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── Wire AP invoices to vendor master (nullable; legacy free-text stays in ap_invoices.vendor) ──
ALTER TABLE "ap_invoices" ADD COLUMN "vendorId" TEXT;
ALTER TABLE "ap_invoices" ADD CONSTRAINT "ap_invoices_vendorId_fkey"
  FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── Allow attachments to be owned by a vendor (contracts, docs, etc.) ──────
ALTER TABLE "attachments" ADD COLUMN "vendorId" TEXT;
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_vendorId_fkey"
  FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "attachments_vendorId_idx" ON "attachments"("vendorId");

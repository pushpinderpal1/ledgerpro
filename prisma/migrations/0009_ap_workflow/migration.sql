-- ─── New enums ──────────────────────────────────────────────────────────────
CREATE TYPE "ApRequestStatus" AS ENUM (
  'SUBMITTED',
  'APPROVED',
  'POSTED',
  'RETURNED_TO_REQUESTER',
  'RETURNED_TO_APPROVER'
);

CREATE TYPE "ApPaymentMode" AS ENUM (
  'ACH',
  'CHEQUE',
  'WIRE',
  'OTHER'
);

-- ─── Attachments (binary blobs in Postgres) ─────────────────────────────────
CREATE TABLE "attachments" (
  "id" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "filename" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "data" BYTEA NOT NULL,
  "uploadedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "attachments_entityId_idx" ON "attachments"("entityId");

ALTER TABLE "attachments" ADD CONSTRAINT "attachments_entityId_fkey"
  FOREIGN KEY ("entityId") REFERENCES "legal_entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── AP requests ────────────────────────────────────────────────────────────
CREATE TABLE "ap_requests" (
  "id" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "vendor" TEXT NOT NULL,
  "invoiceNo" TEXT NOT NULL,
  "invoiceDate" TIMESTAMP(3) NOT NULL,
  "dueDate" TIMESTAMP(3),
  "amount" DECIMAL(18,2) NOT NULL,
  "accountId" TEXT NOT NULL,
  "paymentMode" "ApPaymentMode",
  "description" TEXT,
  "attachmentId" TEXT,
  "status" "ApRequestStatus" NOT NULL DEFAULT 'SUBMITTED',
  "requesterId" TEXT NOT NULL,
  "approverId" TEXT,
  "accountantId" TEXT,
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "approvedAt" TIMESTAMP(3),
  "postedAt" TIMESTAMP(3),
  "apInvoiceId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ap_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ap_requests_apInvoiceId_key" ON "ap_requests"("apInvoiceId");
CREATE INDEX "ap_requests_entityId_status_idx" ON "ap_requests"("entityId", "status");
CREATE INDEX "ap_requests_requesterId_idx" ON "ap_requests"("requesterId");

ALTER TABLE "ap_requests" ADD CONSTRAINT "ap_requests_entityId_fkey"
  FOREIGN KEY ("entityId") REFERENCES "legal_entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ap_requests" ADD CONSTRAINT "ap_requests_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ap_requests" ADD CONSTRAINT "ap_requests_attachmentId_fkey"
  FOREIGN KEY ("attachmentId") REFERENCES "attachments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ap_requests" ADD CONSTRAINT "ap_requests_apInvoiceId_fkey"
  FOREIGN KEY ("apInvoiceId") REFERENCES "ap_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── AP request comments / audit trail ──────────────────────────────────────
CREATE TABLE "ap_request_comments" (
  "id" TEXT NOT NULL,
  "apRequestId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "comment" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ap_request_comments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ap_request_comments_apRequestId_idx" ON "ap_request_comments"("apRequestId");

ALTER TABLE "ap_request_comments" ADD CONSTRAINT "ap_request_comments_apRequestId_fkey"
  FOREIGN KEY ("apRequestId") REFERENCES "ap_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

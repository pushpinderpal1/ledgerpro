-- CreateEnum
CREATE TYPE "ClearedStatus" AS ENUM ('UNCLEARED', 'CLEARED', 'RECONCILED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CHEQUE', 'ACH');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('DRAFT', 'ISSUED', 'CLEARED', 'VOID');

-- CreateEnum
CREATE TYPE "ReconStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED');

-- AlterTable: add clearing fields to journal_lines
ALTER TABLE "journal_lines" ADD COLUMN     "clearedStatus" "ClearedStatus" NOT NULL DEFAULT 'UNCLEARED',
ADD COLUMN     "clearedDate" TIMESTAMP(3),
ADD COLUMN     "reconciledId" TEXT;

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'DRAFT',
    "payeeName" TEXT NOT NULL,
    "payeeClientId" TEXT,
    "amount" DECIMAL(18,2) NOT NULL,
    "paymentDate" TIMESTAMP(3) NOT NULL,
    "memo" TEXT,
    "chequeNo" TEXT,
    "achRoutingNo" TEXT,
    "achAccountNo" TEXT,
    "achAccountType" TEXT,
    "achTraceNo" TEXT,
    "achBatchId" TEXT,
    "achEffectiveDate" TIMESTAMP(3),
    "expenseAccountId" TEXT,
    "journalEntryId" TEXT,
    "apInvoiceId" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_reconciliations" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "statementDate" TIMESTAMP(3) NOT NULL,
    "beginningBalance" DECIMAL(18,2) NOT NULL,
    "endingBalance" DECIMAL(18,2) NOT NULL,
    "status" "ReconStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "statementFile" TEXT,
    "finishedAt" TIMESTAMP(3),
    "finishedBy" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_reconciliations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "statement_lines" (
    "id" TEXT NOT NULL,
    "reconciliationId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "reference" TEXT,
    "matchedLineId" TEXT,
    "isMatched" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "statement_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "journal_lines_accountId_clearedStatus_idx" ON "journal_lines"("accountId", "clearedStatus");
CREATE UNIQUE INDEX "payments_journalEntryId_key" ON "payments"("journalEntryId");
CREATE INDEX "payments_entityId_method_idx" ON "payments"("entityId", "method");
CREATE INDEX "payments_entityId_status_idx" ON "payments"("entityId", "status");
CREATE UNIQUE INDEX "payments_entityId_bankAccountId_chequeNo_key" ON "payments"("entityId", "bankAccountId", "chequeNo");
CREATE INDEX "bank_reconciliations_entityId_bankAccountId_idx" ON "bank_reconciliations"("entityId", "bankAccountId");
CREATE INDEX "statement_lines_reconciliationId_idx" ON "statement_lines"("reconciliationId");

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_reconciledId_fkey" FOREIGN KEY ("reconciledId") REFERENCES "bank_reconciliations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "legal_entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bank_reconciliations" ADD CONSTRAINT "bank_reconciliations_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "legal_entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bank_reconciliations" ADD CONSTRAINT "bank_reconciliations_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "statement_lines" ADD CONSTRAINT "statement_lines_reconciliationId_fkey" FOREIGN KEY ("reconciliationId") REFERENCES "bank_reconciliations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

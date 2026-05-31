-- CreateTable: locked_periods
CREATE TABLE "locked_periods" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "lockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedBy" TEXT,
    "reason" TEXT,
    "releasedAt" TIMESTAMP(3),
    "releasedBy" TEXT,

    CONSTRAINT "locked_periods_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "locked_periods_entityId_periodEnd_idx" ON "locked_periods"("entityId", "periodEnd");
CREATE INDEX "locked_periods_entityId_releasedAt_idx" ON "locked_periods"("entityId", "releasedAt");

ALTER TABLE "locked_periods" ADD CONSTRAINT "locked_periods_entityId_fkey"
  FOREIGN KEY ("entityId") REFERENCES "legal_entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: idempotency_keys
CREATE TABLE "idempotency_keys" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "userId" TEXT,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "responseStatus" INTEGER NOT NULL,
    "responseBody" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "idempotency_keys_entityId_key_key" ON "idempotency_keys"("entityId", "key");
CREATE INDEX "idempotency_keys_createdAt_idx" ON "idempotency_keys"("createdAt");

ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_entityId_fkey"
  FOREIGN KEY ("entityId") REFERENCES "legal_entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

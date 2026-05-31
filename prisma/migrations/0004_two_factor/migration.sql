-- Add TOTP fields to users
ALTER TABLE "users" ADD COLUMN     "totpSecret" TEXT,
ADD COLUMN     "totpEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "totpVerifiedAt" TIMESTAMP(3);

-- One-time backup codes for 2FA recovery
CREATE TABLE "backup_codes" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "backup_codes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "backup_codes_userId_usedAt_idx" ON "backup_codes"("userId", "usedAt");

ALTER TABLE "backup_codes" ADD CONSTRAINT "backup_codes_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

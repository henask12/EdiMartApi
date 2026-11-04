-- Phase 5: registers, shifts, cash movements, denomination counts; Sale.shiftId.

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'SHIFT_EOD';

CREATE TYPE "ShiftStatus" AS ENUM ('OPEN', 'CLOSED');
CREATE TYPE "CashMovementType" AS ENUM ('CASH_IN', 'CASH_OUT', 'NO_SALE_OPEN');
CREATE TYPE "ShiftCountKind" AS ENUM ('OPENING', 'CLOSING');

CREATE TABLE "Register" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "storeCode" TEXT NOT NULL DEFAULT 'DEFAULT_STORE',
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "deviceTokenHint" TEXT,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Register_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Register_code_key" ON "Register"("code");
CREATE INDEX "Register_storeCode_isActive_idx" ON "Register"("storeCode", "isActive");

ALTER TABLE "Register" ADD CONSTRAINT "Register_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "Shift" (
  "id" TEXT NOT NULL,
  "shiftNumber" TEXT NOT NULL,
  "status" "ShiftStatus" NOT NULL DEFAULT 'OPEN',
  "registerId" TEXT NOT NULL,
  "openedByUserId" TEXT NOT NULL,
  "closedByUserId" TEXT,
  "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closedAt" TIMESTAMP(3),
  "openingFloat" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "expectedCash" DECIMAL(12,2),
  "countedCash" DECIMAL(12,2),
  "variance" DECIMAL(12,2),
  "varianceApprovedByUserId" TEXT,
  "notes" TEXT,
  CONSTRAINT "Shift_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Shift_shiftNumber_key" ON "Shift"("shiftNumber");
CREATE INDEX "Shift_status_openedAt_idx" ON "Shift"("status", "openedAt");
CREATE INDEX "Shift_registerId_status_idx" ON "Shift"("registerId", "status");
CREATE INDEX "Shift_openedByUserId_openedAt_idx" ON "Shift"("openedByUserId", "openedAt");

ALTER TABLE "Shift" ADD CONSTRAINT "Shift_registerId_fkey"
  FOREIGN KEY ("registerId") REFERENCES "Register"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_openedByUserId_fkey"
  FOREIGN KEY ("openedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_closedByUserId_fkey"
  FOREIGN KEY ("closedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "CashMovement" (
  "id" TEXT NOT NULL,
  "shiftId" TEXT NOT NULL,
  "type" "CashMovementType" NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "reason" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CashMovement_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CashMovement_shiftId_createdAt_idx" ON "CashMovement"("shiftId", "createdAt");

ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_shiftId_fkey"
  FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ShiftCount" (
  "id" TEXT NOT NULL,
  "shiftId" TEXT NOT NULL,
  "kind" "ShiftCountKind" NOT NULL,
  "denominations" JSONB NOT NULL,
  "total" DECIMAL(12,2) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ShiftCount_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ShiftCount_shiftId_kind_idx" ON "ShiftCount"("shiftId", "kind");

ALTER TABLE "ShiftCount" ADD CONSTRAINT "ShiftCount_shiftId_fkey"
  FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Sale" ADD COLUMN IF NOT EXISTS "shiftId" TEXT;
CREATE INDEX IF NOT EXISTS "Sale_shiftId_idx" ON "Sale"("shiftId");

DO $$ BEGIN
  ALTER TABLE "Sale" ADD CONSTRAINT "Sale_shiftId_fkey"
    FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Default till for the shop
INSERT INTO "Register" ("id", "code", "name", "storeCode", "isActive", "createdAt", "updatedAt")
VALUES ('reg_default_phase5', 'REGISTER-1', 'Main till', 'DEFAULT_STORE', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;
-- updatedAt has no DEFAULT (Prisma @updatedAt); seed row supplies an explicit value.

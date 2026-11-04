-- Phase 0: correctness and safety foundations. Additive only; nothing is dropped or renamed.

-- Users must change seeded / admin-set passwords on first login.
ALTER TABLE "User" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;

-- Real payment methods for Ethiopian retail (checkout used to hard-code CASH).
ALTER TYPE "PaymentMethod" ADD VALUE 'TELEBIRR';
ALTER TYPE "PaymentMethod" ADD VALUE 'CBE_BIRR';
ALTER TYPE "PaymentMethod" ADD VALUE 'MPESA';
ALTER TYPE "PaymentMethod" ADD VALUE 'BANK_TRANSFER';

-- Mobile money / bank transaction reference.
ALTER TABLE "PaymentAllocation" ADD COLUMN "reference" TEXT;

-- Reservation expiry sweep.
CREATE INDEX "Reservation_status_expiresAt_idx" ON "Reservation"("status", "expiresAt");

-- Race-free, business-day document numbering.
CREATE TABLE "DocumentCounter" (
    "scope" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DocumentCounter_pkey" PRIMARY KEY ("scope","date")
);

-- Idempotent checkout.
CREATE TABLE "IdempotencyKey" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "saleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IdempotencyKey_scope_key_key" ON "IdempotencyKey"("scope", "key");
CREATE INDEX "IdempotencyKey_createdAt_idx" ON "IdempotencyKey"("createdAt");

-- Stock can never go below zero. NOT VALID: enforced for every new/changed row but does not
-- fail the migration if historical drift already left a negative row (the reconciliation
-- script reports those; fix them, then run VALIDATE CONSTRAINT).
ALTER TABLE "InventoryItem"
  ADD CONSTRAINT "InventoryItem_quantityOnHand_nonneg" CHECK ("quantityOnHand" >= 0) NOT VALID;
ALTER TABLE "StockBatch"
  ADD CONSTRAINT "StockBatch_qtyRemaining_nonneg" CHECK ("qtyRemaining" >= 0) NOT VALID;

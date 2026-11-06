-- Phase 4: POS — sale notes/fiscal stubs, payment tender/change, parked carts, credit notes.

-- Sale extensions (additive)
ALTER TABLE "Sale" ADD COLUMN IF NOT EXISTS "notes" TEXT;
ALTER TABLE "Sale" ADD COLUMN IF NOT EXISTS "discountReason" TEXT;
ALTER TABLE "Sale" ADD COLUMN IF NOT EXISTS "fiscalStatus" TEXT NOT NULL DEFAULT 'NONE';
ALTER TABLE "Sale" ADD COLUMN IF NOT EXISTS "fiscalRegistrationNumber" TEXT;
ALTER TABLE "Sale" ADD COLUMN IF NOT EXISTS "fiscalQrPayload" TEXT;
ALTER TABLE "Sale" ADD COLUMN IF NOT EXISTS "voidedAt" TIMESTAMP(3);
ALTER TABLE "Sale" ADD COLUMN IF NOT EXISTS "voidReason" TEXT;
ALTER TABLE "Sale" ADD COLUMN IF NOT EXISTS "voidedByUserId" TEXT;

CREATE INDEX IF NOT EXISTS "Sale_status_createdAt_idx" ON "Sale"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "Sale_createdByUserId_createdAt_idx" ON "Sale"("createdByUserId", "createdAt");

DO $$ BEGIN
  ALTER TABLE "Sale" ADD CONSTRAINT "Sale_voidedByUserId_fkey"
    FOREIGN KEY ("voidedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- SaleLine extensions
ALTER TABLE "SaleLine" ADD COLUMN IF NOT EXISTS "originalUnitPrice" DECIMAL(12,2);
ALTER TABLE "SaleLine" ADD COLUMN IF NOT EXISTS "priceOverridden" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SaleLine" ADD COLUMN IF NOT EXISTS "discountReason" TEXT;

-- PaymentAllocation extensions
ALTER TABLE "PaymentAllocation" ADD COLUMN IF NOT EXISTS "tenderedAmount" DECIMAL(12,2);
ALTER TABLE "PaymentAllocation" ADD COLUMN IF NOT EXISTS "changeAmount" DECIMAL(12,2);
ALTER TABLE "PaymentAllocation" ADD COLUMN IF NOT EXISTS "proofImagePath" TEXT;
ALTER TABLE "PaymentAllocation" ADD COLUMN IF NOT EXISTS "createdByUserId" TEXT;
ALTER TABLE "PaymentAllocation" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

DO $$ BEGIN
  ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Credit condition enum
DO $$ BEGIN
  CREATE TYPE "CreditCondition" AS ENUM ('RESTOCK', 'DAMAGED', 'NEEDS_INSPECTION');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "CreditNote" (
  "id" TEXT NOT NULL,
  "creditNumber" TEXT NOT NULL,
  "saleId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "condition" "CreditCondition" NOT NULL DEFAULT 'RESTOCK',
  "refundMethod" "PaymentMethod",
  "refundAmount" DECIMAL(12,2) NOT NULL,
  "refundReference" TEXT,
  "notes" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CreditNote_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CreditNote_creditNumber_key" ON "CreditNote"("creditNumber");
CREATE INDEX IF NOT EXISTS "CreditNote_saleId_idx" ON "CreditNote"("saleId");
CREATE INDEX IF NOT EXISTS "CreditNote_createdAt_idx" ON "CreditNote"("createdAt");

DO $$ BEGIN
  ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_saleId_fkey"
    FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "CreditNoteLine" (
  "id" TEXT NOT NULL,
  "creditNoteId" TEXT NOT NULL,
  "saleLineId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "quantity" DECIMAL(18,4) NOT NULL,
  "unitPrice" DECIMAL(12,2) NOT NULL,
  "lineTotal" DECIMAL(12,2) NOT NULL,
  "restockLocationId" TEXT,
  CONSTRAINT "CreditNoteLine_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CreditNoteLine_creditNoteId_idx" ON "CreditNoteLine"("creditNoteId");
CREATE INDEX IF NOT EXISTS "CreditNoteLine_saleLineId_idx" ON "CreditNoteLine"("saleLineId");
CREATE INDEX IF NOT EXISTS "CreditNoteLine_productId_idx" ON "CreditNoteLine"("productId");

DO $$ BEGIN
  ALTER TABLE "CreditNoteLine" ADD CONSTRAINT "CreditNoteLine_creditNoteId_fkey"
    FOREIGN KEY ("creditNoteId") REFERENCES "CreditNote"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "CreditNoteLine" ADD CONSTRAINT "CreditNoteLine_saleLineId_fkey"
    FOREIGN KEY ("saleLineId") REFERENCES "SaleLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "CreditNoteLine" ADD CONSTRAINT "CreditNoteLine_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "CreditNoteLine" ADD CONSTRAINT "CreditNoteLine_restockLocationId_fkey"
    FOREIGN KEY ("restockLocationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "ParkedCart" (
  "id" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "notes" TEXT,
  "payload" JSONB NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resumedAt" TIMESTAMP(3),
  CONSTRAINT "ParkedCart_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ParkedCart_createdByUserId_createdAt_idx" ON "ParkedCart"("createdByUserId", "createdAt");
CREATE INDEX IF NOT EXISTS "ParkedCart_expiresAt_idx" ON "ParkedCart"("expiresAt");

DO $$ BEGIN
  ALTER TABLE "ParkedCart" ADD CONSTRAINT "ParkedCart_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

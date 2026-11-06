-- Phase 7: customers, credit ledger, store credit, loyalty, promotions, layaway fields.

ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'STORE_CREDIT';
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'CUSTOMER_ACCOUNT';

DO $$ BEGIN
  CREATE TYPE "CustomerLedgerKind" AS ENUM (
    'SALE_CREDIT', 'REPAYMENT', 'STORE_CREDIT_ISSUE', 'STORE_CREDIT_REDEEM', 'ADJUSTMENT'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "LoyaltyTxnKind" AS ENUM ('EARN', 'REDEEM', 'ADJUST');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "PromotionType" AS ENUM (
    'PERCENT_OFF', 'FIXED_OFF', 'MIN_SPEND_PERCENT', 'MIN_SPEND_FIXED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "PromotionTarget" AS ENUM ('ALL', 'PRODUCT', 'CATEGORY');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "Customer" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "email" TEXT,
  "birthday" DATE,
  "notes" TEXT,
  "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "creditLimit" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "creditBalance" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "storeCreditBalance" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "loyaltyPoints" INTEGER NOT NULL DEFAULT 0,
  "loyaltyTier" TEXT,
  "marketingOptOut" BOOLEAN NOT NULL DEFAULT false,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Customer_phone_key" ON "Customer"("phone");
CREATE INDEX IF NOT EXISTS "Customer_name_idx" ON "Customer"("name");
CREATE INDEX IF NOT EXISTS "Customer_isActive_name_idx" ON "Customer"("isActive", "name");
CREATE INDEX IF NOT EXISTS "Customer_creditBalance_idx" ON "Customer"("creditBalance");

DO $$ BEGIN
  ALTER TABLE "Customer" ADD CONSTRAINT "Customer_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "Reservation" ADD COLUMN IF NOT EXISTS "customerId" TEXT;
ALTER TABLE "Reservation" ADD COLUMN IF NOT EXISTS "totalPrice" DECIMAL(12,2);
ALTER TABLE "Reservation" ADD COLUMN IF NOT EXISTS "depositPaid" DECIMAL(12,2) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS "Reservation_customerId_idx" ON "Reservation"("customerId");

DO $$ BEGIN
  ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "Sale" ADD COLUMN IF NOT EXISTS "customerId" TEXT;
ALTER TABLE "Sale" ADD COLUMN IF NOT EXISTS "loyaltyPointsEarned" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Sale" ADD COLUMN IF NOT EXISTS "loyaltyPointsRedeemed" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS "Sale_customerId_idx" ON "Sale"("customerId");

DO $$ BEGIN
  ALTER TABLE "Sale" ADD CONSTRAINT "Sale_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "CustomerLedgerEntry" (
  "id" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "kind" "CustomerLedgerKind" NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "balanceAfter" DECIMAL(12,2) NOT NULL,
  "saleId" TEXT,
  "creditNoteId" TEXT,
  "notes" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CustomerLedgerEntry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CustomerLedgerEntry_customerId_createdAt_idx"
  ON "CustomerLedgerEntry"("customerId", "createdAt");
CREATE INDEX IF NOT EXISTS "CustomerLedgerEntry_saleId_idx" ON "CustomerLedgerEntry"("saleId");
CREATE INDEX IF NOT EXISTS "CustomerLedgerEntry_kind_createdAt_idx"
  ON "CustomerLedgerEntry"("kind", "createdAt");

DO $$ BEGIN
  ALTER TABLE "CustomerLedgerEntry" ADD CONSTRAINT "CustomerLedgerEntry_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "CustomerLedgerEntry" ADD CONSTRAINT "CustomerLedgerEntry_saleId_fkey"
    FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "CustomerLedgerEntry" ADD CONSTRAINT "CustomerLedgerEntry_creditNoteId_fkey"
    FOREIGN KEY ("creditNoteId") REFERENCES "CreditNote"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "CustomerLedgerEntry" ADD CONSTRAINT "CustomerLedgerEntry_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "LoyaltyTransaction" (
  "id" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "kind" "LoyaltyTxnKind" NOT NULL,
  "points" INTEGER NOT NULL,
  "balanceAfter" INTEGER NOT NULL,
  "saleId" TEXT,
  "notes" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LoyaltyTransaction_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "LoyaltyTransaction_customerId_createdAt_idx"
  ON "LoyaltyTransaction"("customerId", "createdAt");
CREATE INDEX IF NOT EXISTS "LoyaltyTransaction_saleId_idx" ON "LoyaltyTransaction"("saleId");

DO $$ BEGIN
  ALTER TABLE "LoyaltyTransaction" ADD CONSTRAINT "LoyaltyTransaction_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "LoyaltyTransaction" ADD CONSTRAINT "LoyaltyTransaction_saleId_fkey"
    FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "LoyaltyTransaction" ADD CONSTRAINT "LoyaltyTransaction_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "Promotion" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "code" TEXT,
  "type" "PromotionType" NOT NULL,
  "value" DECIMAL(12,2) NOT NULL,
  "minSpend" DECIMAL(12,2),
  "target" "PromotionTarget" NOT NULL DEFAULT 'ALL',
  "productId" TEXT,
  "categoryId" TEXT,
  "startsAt" TIMESTAMP(3),
  "endsAt" TIMESTAMP(3),
  "daysOfWeek" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  "startHour" INTEGER,
  "endHour" INTEGER,
  "priority" INTEGER NOT NULL DEFAULT 0,
  "stackable" BOOLEAN NOT NULL DEFAULT false,
  "maxUses" INTEGER,
  "maxUsesPerCustomer" INTEGER,
  "usageCount" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Promotion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Promotion_code_key" ON "Promotion"("code");
CREATE INDEX IF NOT EXISTS "Promotion_isActive_priority_idx" ON "Promotion"("isActive", "priority");
CREATE INDEX IF NOT EXISTS "Promotion_startsAt_endsAt_idx" ON "Promotion"("startsAt", "endsAt");
CREATE INDEX IF NOT EXISTS "Promotion_productId_idx" ON "Promotion"("productId");
CREATE INDEX IF NOT EXISTS "Promotion_categoryId_idx" ON "Promotion"("categoryId");

DO $$ BEGIN
  ALTER TABLE "Promotion" ADD CONSTRAINT "Promotion_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "Promotion" ADD CONSTRAINT "Promotion_categoryId_fkey"
    FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "Promotion" ADD CONSTRAINT "Promotion_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "PromotionUsage" (
  "id" TEXT NOT NULL,
  "promotionId" TEXT NOT NULL,
  "saleId" TEXT NOT NULL,
  "customerId" TEXT,
  "discountAmount" DECIMAL(12,2) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PromotionUsage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PromotionUsage_promotionId_idx" ON "PromotionUsage"("promotionId");
CREATE INDEX IF NOT EXISTS "PromotionUsage_saleId_idx" ON "PromotionUsage"("saleId");
CREATE INDEX IF NOT EXISTS "PromotionUsage_customerId_idx" ON "PromotionUsage"("customerId");

DO $$ BEGIN
  ALTER TABLE "PromotionUsage" ADD CONSTRAINT "PromotionUsage_promotionId_fkey"
    FOREIGN KEY ("promotionId") REFERENCES "Promotion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "PromotionUsage" ADD CONSTRAINT "PromotionUsage_saleId_fkey"
    FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "PromotionUsage" ADD CONSTRAINT "PromotionUsage_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

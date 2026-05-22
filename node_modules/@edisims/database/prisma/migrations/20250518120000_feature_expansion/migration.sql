-- Feature expansion: product types, user active flag, sale attachments, OOS alerts

-- NotificationType: OUT_OF_STOCK
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'OUT_OF_STOCK';

-- User.isActive
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true;

-- ProductType
CREATE TABLE IF NOT EXISTS "ProductType" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProductType_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProductType_name_key" ON "ProductType"("name");

-- Product: type + OOS alert dedupe
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "productTypeId" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "lastOutOfStockAlertAt" TIMESTAMP(3);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Product_productTypeId_fkey'
  ) THEN
    ALTER TABLE "Product"
      ADD CONSTRAINT "Product_productTypeId_fkey"
      FOREIGN KEY ("productTypeId") REFERENCES "ProductType"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Sale proof attachments
CREATE TABLE IF NOT EXISTS "SaleAttachment" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "imagePath" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SaleAttachment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SaleAttachment_saleId_idx" ON "SaleAttachment"("saleId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'SaleAttachment_saleId_fkey'
  ) THEN
    ALTER TABLE "SaleAttachment"
      ADD CONSTRAINT "SaleAttachment_saleId_fkey"
      FOREIGN KEY ("saleId") REFERENCES "Sale"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

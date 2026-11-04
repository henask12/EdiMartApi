-- Phase 3: Inventory core. Additive only.

-- ===========================
-- 1. Enums: new MovementType values + new domain enums
-- ===========================
-- Postgres cannot use a newly-added enum value in the same transaction
-- that adds it, but ALTER TYPE ... ADD VALUE IF NOT EXISTS runs outside
-- transactions (Prisma wraps each migration in one, but ADD VALUE is safe
-- because it commits immediately).

ALTER TYPE "MovementType" ADD VALUE IF NOT EXISTS 'WRITE_OFF';
ALTER TYPE "MovementType" ADD VALUE IF NOT EXISTS 'COUNT';

-- TaxCategory
DO $$ BEGIN
  CREATE TYPE "TaxCategory" AS ENUM ('STANDARD','ZERO_RATED','EXEMPT');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AdjustReason
DO $$ BEGIN
  CREATE TYPE "AdjustReason" AS ENUM ('DAMAGED','EXPIRED','THEFT_LOSS','INTERNAL_USE','GIFT_SAMPLE','DATA_CORRECTION','OTHER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- TransferStatus
DO $$ BEGIN
  CREATE TYPE "TransferStatus" AS ENUM ('DRAFT','SENT','RECEIVED','CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- StockCountType
DO $$ BEGIN
  CREATE TYPE "StockCountType" AS ENUM ('FULL','CYCLE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- StockCountStatus
DO $$ BEGIN
  CREATE TYPE "StockCountStatus" AS ENUM ('DRAFT','IN_PROGRESS','REVIEW','POSTED','CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- LabelJobStatus
DO $$ BEGIN
  CREATE TYPE "LabelJobStatus" AS ENUM ('PENDING','PRINTED','CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- BarcodeKind
DO $$ BEGIN
  CREATE TYPE "BarcodeKind" AS ENUM ('EAN13','CODE128','INTERNAL','OTHER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ===========================
-- 2. Location: add sellable, storeCode, sortOrder, binCode, isActive
-- ===========================
ALTER TABLE "Location" ADD COLUMN IF NOT EXISTS "sellable" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Location" ADD COLUMN IF NOT EXISTS "storeCode" TEXT NOT NULL DEFAULT 'DEFAULT_STORE';
ALTER TABLE "Location" ADD COLUMN IF NOT EXISTS "sortOrder" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Location" ADD COLUMN IF NOT EXISTS "binCode" TEXT;
ALTER TABLE "Location" ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Location" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Rename DEFAULT_STORE display name to "Shop floor"
UPDATE "Location" SET "name" = 'Shop floor' WHERE "code" = 'DEFAULT_STORE' AND "name" = 'Main Store';

-- Insert BACK_STORE and QUARANTINE if they don't exist
INSERT INTO "Location" ("id", "code", "name", "storeCode", "sellable", "sortOrder", "isActive", "createdAt")
VALUES ('loc_back_store_phase3', 'BACK_STORE', 'Back store', 'DEFAULT_STORE', true, 10, true, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "Location" ("id", "code", "name", "storeCode", "sellable", "sortOrder", "isActive", "createdAt")
VALUES ('loc_quarantine_phase3', 'QUARANTINE', 'Quarantine', 'DEFAULT_STORE', false, 20, true, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

CREATE INDEX IF NOT EXISTS "Location_storeCode_sellable_idx" ON "Location"("storeCode", "sellable");

-- ===========================
-- 3. Product: new columns
-- ===========================
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "nameAm" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "brand" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "minStock" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "maxStock" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "leadTimeDays" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "trackBatches" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "defaultLocationId" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP(3);
UPDATE "Product" SET "trackBatches" = true WHERE "expiryDate" IS NOT NULL AND "trackBatches" = false;

-- taxCategory: the column may already exist from schema_catchup;
-- just add it idempotently in case it's missing
DO $$ BEGIN
  ALTER TABLE "Product" ADD COLUMN "taxCategory" "TaxCategory" NOT NULL DEFAULT 'STANDARD';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "Product_brand_idx" ON "Product"("brand");
CREATE INDEX IF NOT EXISTS "Product_archivedAt_idx" ON "Product"("archivedAt");

-- ===========================
-- 4. ProductBarcode
-- ===========================
CREATE TABLE IF NOT EXISTS "ProductBarcode" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "barcode" TEXT NOT NULL,
    "kind" "BarcodeKind" NOT NULL DEFAULT 'INTERNAL',
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductBarcode_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ProductBarcode_barcode_key" ON "ProductBarcode"("barcode");
CREATE INDEX IF NOT EXISTS "ProductBarcode_productId_idx" ON "ProductBarcode"("productId");
ALTER TABLE "ProductBarcode" DROP CONSTRAINT IF EXISTS "ProductBarcode_productId_fkey";
ALTER TABLE "ProductBarcode" ADD CONSTRAINT "ProductBarcode_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ===========================
-- 5. StockBatch: locationId + lotNumber
-- ===========================
ALTER TABLE "StockBatch" ADD COLUMN IF NOT EXISTS "locationId" TEXT;
ALTER TABLE "StockBatch" ADD COLUMN IF NOT EXISTS "lotNumber" TEXT;

-- Backfill StockBatch.locationId from DEFAULT_STORE inventory location
UPDATE "StockBatch" SET "locationId" = (
  SELECT "id" FROM "Location" WHERE "code" = 'DEFAULT_STORE' LIMIT 1
) WHERE "locationId" IS NULL;

CREATE INDEX IF NOT EXISTS "StockBatch_locationId_productId_idx" ON "StockBatch"("locationId", "productId");
CREATE INDEX IF NOT EXISTS "StockBatch_lotNumber_idx" ON "StockBatch"("lotNumber");

ALTER TABLE "StockBatch" DROP CONSTRAINT IF EXISTS "StockBatch_locationId_fkey";
ALTER TABLE "StockBatch" ADD CONSTRAINT "StockBatch_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ===========================
-- 6. StockMovement: reasonCode column
-- ===========================
ALTER TABLE "StockMovement" ADD COLUMN IF NOT EXISTS "reasonCode" "AdjustReason";
CREATE INDEX IF NOT EXISTS "StockMovement_reasonCode_idx" ON "StockMovement"("reasonCode");

-- ===========================
-- 7. SaleLineBatch
-- ===========================
CREATE TABLE IF NOT EXISTS "SaleLineBatch" (
    "id" TEXT NOT NULL,
    "saleLineId" TEXT NOT NULL,
    "stockBatchId" TEXT,
    "quantity" DECIMAL(18,4) NOT NULL,

    CONSTRAINT "SaleLineBatch_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "SaleLineBatch_saleLineId_idx" ON "SaleLineBatch"("saleLineId");
CREATE INDEX IF NOT EXISTS "SaleLineBatch_stockBatchId_idx" ON "SaleLineBatch"("stockBatchId");
ALTER TABLE "SaleLineBatch" DROP CONSTRAINT IF EXISTS "SaleLineBatch_saleLineId_fkey";
ALTER TABLE "SaleLineBatch" ADD CONSTRAINT "SaleLineBatch_saleLineId_fkey"
  FOREIGN KEY ("saleLineId") REFERENCES "SaleLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SaleLineBatch" DROP CONSTRAINT IF EXISTS "SaleLineBatch_stockBatchId_fkey";
ALTER TABLE "SaleLineBatch" ADD CONSTRAINT "SaleLineBatch_stockBatchId_fkey"
  FOREIGN KEY ("stockBatchId") REFERENCES "StockBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ===========================
-- 8. StockTransfer + StockTransferLine
-- ===========================
CREATE TABLE IF NOT EXISTS "StockTransfer" (
    "id" TEXT NOT NULL,
    "transferNumber" TEXT NOT NULL,
    "status" "TransferStatus" NOT NULL DEFAULT 'DRAFT',
    "fromLocationId" TEXT NOT NULL,
    "toLocationId" TEXT NOT NULL,
    "notes" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "receivedByUserId" TEXT,
    "sentAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockTransfer_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "StockTransfer_transferNumber_key" ON "StockTransfer"("transferNumber");
CREATE INDEX IF NOT EXISTS "StockTransfer_status_createdAt_idx" ON "StockTransfer"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "StockTransfer_fromLocationId_idx" ON "StockTransfer"("fromLocationId");
CREATE INDEX IF NOT EXISTS "StockTransfer_toLocationId_idx" ON "StockTransfer"("toLocationId");

ALTER TABLE "StockTransfer" DROP CONSTRAINT IF EXISTS "StockTransfer_fromLocationId_fkey";
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_fromLocationId_fkey"
  FOREIGN KEY ("fromLocationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockTransfer" DROP CONSTRAINT IF EXISTS "StockTransfer_toLocationId_fkey";
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_toLocationId_fkey"
  FOREIGN KEY ("toLocationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockTransfer" DROP CONSTRAINT IF EXISTS "StockTransfer_createdByUserId_fkey";
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockTransfer" DROP CONSTRAINT IF EXISTS "StockTransfer_receivedByUserId_fkey";
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_receivedByUserId_fkey"
  FOREIGN KEY ("receivedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "StockTransferLine" (
    "id" TEXT NOT NULL,
    "transferId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "stockBatchId" TEXT,

    CONSTRAINT "StockTransferLine_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "StockTransferLine_transferId_idx" ON "StockTransferLine"("transferId");
CREATE INDEX IF NOT EXISTS "StockTransferLine_productId_idx" ON "StockTransferLine"("productId");

ALTER TABLE "StockTransferLine" DROP CONSTRAINT IF EXISTS "StockTransferLine_transferId_fkey";
ALTER TABLE "StockTransferLine" ADD CONSTRAINT "StockTransferLine_transferId_fkey"
  FOREIGN KEY ("transferId") REFERENCES "StockTransfer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StockTransferLine" DROP CONSTRAINT IF EXISTS "StockTransferLine_productId_fkey";
ALTER TABLE "StockTransferLine" ADD CONSTRAINT "StockTransferLine_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===========================
-- 9. StockCount + StockCountLine
-- ===========================
CREATE TABLE IF NOT EXISTS "StockCount" (
    "id" TEXT NOT NULL,
    "countNumber" TEXT NOT NULL,
    "type" "StockCountType" NOT NULL DEFAULT 'FULL',
    "status" "StockCountStatus" NOT NULL DEFAULT 'DRAFT',
    "locationId" TEXT,
    "notes" TEXT,
    "startedAt" TIMESTAMP(3),
    "postedAt" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,
    "postedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockCount_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "StockCount_countNumber_key" ON "StockCount"("countNumber");
CREATE INDEX IF NOT EXISTS "StockCount_status_createdAt_idx" ON "StockCount"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "StockCount_locationId_idx" ON "StockCount"("locationId");

ALTER TABLE "StockCount" DROP CONSTRAINT IF EXISTS "StockCount_locationId_fkey";
ALTER TABLE "StockCount" ADD CONSTRAINT "StockCount_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StockCount" DROP CONSTRAINT IF EXISTS "StockCount_createdByUserId_fkey";
ALTER TABLE "StockCount" ADD CONSTRAINT "StockCount_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockCount" DROP CONSTRAINT IF EXISTS "StockCount_postedByUserId_fkey";
ALTER TABLE "StockCount" ADD CONSTRAINT "StockCount_postedByUserId_fkey"
  FOREIGN KEY ("postedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "StockCountLine" (
    "id" TEXT NOT NULL,
    "countId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "systemQtySnapshot" DECIMAL(18,4) NOT NULL,
    "countedQty" DECIMAL(18,4),
    "varianceQty" DECIMAL(18,4),
    "needsRecount" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,

    CONSTRAINT "StockCountLine_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "StockCountLine_countId_productId_key" ON "StockCountLine"("countId", "productId");
CREATE INDEX IF NOT EXISTS "StockCountLine_productId_idx" ON "StockCountLine"("productId");

ALTER TABLE "StockCountLine" DROP CONSTRAINT IF EXISTS "StockCountLine_countId_fkey";
ALTER TABLE "StockCountLine" ADD CONSTRAINT "StockCountLine_countId_fkey"
  FOREIGN KEY ("countId") REFERENCES "StockCount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StockCountLine" DROP CONSTRAINT IF EXISTS "StockCountLine_productId_fkey";
ALTER TABLE "StockCountLine" ADD CONSTRAINT "StockCountLine_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===========================
-- 10. PriceChange
-- ===========================
CREATE TABLE IF NOT EXISTS "PriceChange" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "oldPrice" DECIMAL(12,2) NOT NULL,
    "newPrice" DECIMAL(12,2) NOT NULL,
    "effectiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,

    CONSTRAINT "PriceChange_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "PriceChange_productId_effectiveAt_idx" ON "PriceChange"("productId", "effectiveAt");
CREATE INDEX IF NOT EXISTS "PriceChange_effectiveAt_idx" ON "PriceChange"("effectiveAt");

ALTER TABLE "PriceChange" DROP CONSTRAINT IF EXISTS "PriceChange_productId_fkey";
ALTER TABLE "PriceChange" ADD CONSTRAINT "PriceChange_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PriceChange" DROP CONSTRAINT IF EXISTS "PriceChange_createdByUserId_fkey";
ALTER TABLE "PriceChange" ADD CONSTRAINT "PriceChange_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ===========================
-- 11. LabelReprintQueue
-- ===========================
CREATE TABLE IF NOT EXISTS "LabelReprintQueue" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "LabelJobStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "printedAt" TIMESTAMP(3),

    CONSTRAINT "LabelReprintQueue_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "LabelReprintQueue_status_createdAt_idx" ON "LabelReprintQueue"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "LabelReprintQueue_productId_idx" ON "LabelReprintQueue"("productId");

ALTER TABLE "LabelReprintQueue" DROP CONSTRAINT IF EXISTS "LabelReprintQueue_productId_fkey";
ALTER TABLE "LabelReprintQueue" ADD CONSTRAINT "LabelReprintQueue_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ===========================
-- 12. InventorySnapshot
-- ===========================
CREATE TABLE IF NOT EXISTS "InventorySnapshot" (
    "id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "valueAtCost" DECIMAL(14,2) NOT NULL,
    "valueAtRetail" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventorySnapshot_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "InventorySnapshot_date_productId_locationId_key"
  ON "InventorySnapshot"("date", "productId", "locationId");
CREATE INDEX IF NOT EXISTS "InventorySnapshot_date_idx" ON "InventorySnapshot"("date");

ALTER TABLE "InventorySnapshot" DROP CONSTRAINT IF EXISTS "InventorySnapshot_productId_fkey";
ALTER TABLE "InventorySnapshot" ADD CONSTRAINT "InventorySnapshot_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InventorySnapshot" DROP CONSTRAINT IF EXISTS "InventorySnapshot_locationId_fkey";
ALTER TABLE "InventorySnapshot" ADD CONSTRAINT "InventorySnapshot_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- FK for Product.defaultLocationId
ALTER TABLE "Product" DROP CONSTRAINT IF EXISTS "Product_defaultLocationId_fkey";
ALTER TABLE "Product" ADD CONSTRAINT "Product_defaultLocationId_fkey"
  FOREIGN KEY ("defaultLocationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

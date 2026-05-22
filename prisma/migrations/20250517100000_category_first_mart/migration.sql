-- Category-first mart schema evolution

-- New enums
CREATE TYPE "ReservationStatus" AS ENUM ('RESERVED', 'COMPLETED', 'CANCELLED', 'EXPIRED');
CREATE TYPE "NotificationType" AS ENUM ('LOW_STOCK', 'EXPIRY');

ALTER TYPE "MovementType" ADD VALUE IF NOT EXISTS 'RESERVE';
ALTER TYPE "MovementType" ADD VALUE IF NOT EXISTS 'RELEASE_RESERVE';
ALTER TYPE "MovementType" ADD VALUE IF NOT EXISTS 'DAMAGE';

-- Product changes
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "imagePath" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "restockQty" INTEGER NOT NULL DEFAULT 0;

-- Assign orphan products to a default category
INSERT INTO "Category" (id, name, "createdAt")
SELECT 'cat-default-misc', 'General', NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Category" WHERE name = 'General');

UPDATE "Product" SET "categoryId" = (SELECT id FROM "Category" WHERE name = 'General' LIMIT 1)
WHERE "categoryId" IS NULL;

ALTER TABLE "Product" DROP CONSTRAINT IF EXISTS "Product_name_key";
DROP INDEX IF EXISTS "Product_name_key";

ALTER TABLE "Product" ALTER COLUMN "categoryId" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "Product_categoryId_name_key" ON "Product"("categoryId", "name");

-- Stock movement metadata
ALTER TABLE "StockMovement" ADD COLUMN IF NOT EXISTS "stockBatchId" TEXT;
ALTER TABLE "StockMovement" ADD COLUMN IF NOT EXISTS "beforeOnHand" DECIMAL(18,4);
ALTER TABLE "StockMovement" ADD COLUMN IF NOT EXISTS "afterOnHand" DECIMAL(18,4);
ALTER TABLE "StockMovement" ADD COLUMN IF NOT EXISTS "metadata" JSONB;

-- StockBatch
CREATE TABLE IF NOT EXISTS "StockBatch" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "qtyReceived" DECIMAL(18,4) NOT NULL,
    "qtyRemaining" DECIMAL(18,4) NOT NULL,
    "unitCost" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "expiryDate" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receivedByUserId" TEXT,
    CONSTRAINT "StockBatch_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "StockBatch_productId_receivedAt_idx" ON "StockBatch"("productId", "receivedAt");
CREATE INDEX IF NOT EXISTS "StockBatch_expiryDate_idx" ON "StockBatch"("expiryDate");

ALTER TABLE "StockBatch" ADD CONSTRAINT "StockBatch_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StockBatch" ADD CONSTRAINT "StockBatch_receivedByUserId_fkey" FOREIGN KEY ("receivedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_stockBatchId_fkey" FOREIGN KEY ("stockBatchId") REFERENCES "StockBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Reservation
CREATE TABLE IF NOT EXISTS "Reservation" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "status" "ReservationStatus" NOT NULL DEFAULT 'RESERVED',
    "customerName" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Reservation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Reservation_productId_status_idx" ON "Reservation"("productId", "status");
CREATE INDEX IF NOT EXISTS "Reservation_status_idx" ON "Reservation"("status");

ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Notifications
CREATE TABLE IF NOT EXISTS "NotificationEmail" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NotificationEmail_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "NotificationEmail_email_key" ON "NotificationEmail"("email");

CREATE TABLE IF NOT EXISTS "NotificationLog" (
    "id" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,
    CONSTRAINT "NotificationLog_pkey" PRIMARY KEY ("id")
);

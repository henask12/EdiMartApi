-- Phase 8: daily sales / product summaries for dashboards and reports.

CREATE TABLE IF NOT EXISTS "DailySalesSummary" (
  "id" TEXT NOT NULL,
  "businessDate" TEXT NOT NULL,
  "saleCount" INTEGER NOT NULL DEFAULT 0,
  "voidCount" INTEGER NOT NULL DEFAULT 0,
  "returnCount" INTEGER NOT NULL DEFAULT 0,
  "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "discountTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "taxTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "grandTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "costTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "paymentsByMethod" JSONB NOT NULL DEFAULT '{}',
  "salesByHour" JSONB NOT NULL DEFAULT '[]',
  "rebuiltAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DailySalesSummary_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DailySalesSummary_businessDate_key" ON "DailySalesSummary"("businessDate");
CREATE INDEX IF NOT EXISTS "DailySalesSummary_businessDate_idx" ON "DailySalesSummary"("businessDate");

CREATE TABLE IF NOT EXISTS "DailyProductSales" (
  "id" TEXT NOT NULL,
  "businessDate" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "quantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "revenue" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "cost" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "lineCount" INTEGER NOT NULL DEFAULT 0,
  "rebuiltAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DailyProductSales_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DailyProductSales_businessDate_productId_key"
  ON "DailyProductSales"("businessDate", "productId");
CREATE INDEX IF NOT EXISTS "DailyProductSales_businessDate_idx" ON "DailyProductSales"("businessDate");
CREATE INDEX IF NOT EXISTS "DailyProductSales_productId_businessDate_idx"
  ON "DailyProductSales"("productId", "businessDate");

DO $$ BEGIN
  ALTER TABLE "DailyProductSales" ADD CONSTRAINT "DailyProductSales_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Hot filters for reports (additive indexes only).
CREATE INDEX IF NOT EXISTS "Sale_status_createdAt_idx" ON "Sale"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "StockMovement_type_createdAt_idx" ON "StockMovement"("type", "createdAt");
CREATE INDEX IF NOT EXISTS "PaymentAllocation_method_createdAt_idx" ON "PaymentAllocation"("method", "createdAt");

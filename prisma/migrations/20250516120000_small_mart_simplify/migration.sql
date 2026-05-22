-- Small mart: unique product names, restockAt, optional sku
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "restockAt" INTEGER NOT NULL DEFAULT 0;

UPDATE "Product" SET "restockAt" = COALESCE("lowStockThreshold", 0)
WHERE EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_name = 'Product' AND column_name = 'lowStockThreshold'
);

ALTER TABLE "Product" DROP COLUMN IF EXISTS "lowStockThreshold";
ALTER TABLE "Product" DROP COLUMN IF EXISTS "reorderPoint";

ALTER TABLE "Product" ALTER COLUMN "sku" DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "Product_name_key" ON "Product"("name");

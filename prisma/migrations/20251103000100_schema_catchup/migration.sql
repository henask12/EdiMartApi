-- Brings the migration history in line with prisma/schema.prisma.
--
-- Production was partly built with `prisma db push`, so some columns exist there but were never
-- in any migration (a database created purely from `migrate deploy` lacked Product.originCountry,
-- which the application uses). Every statement here is idempotent, so it is a no-op on a database
-- that already has the change and a repair on one that does not. Nothing is dropped.

ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "originCountry" TEXT;

ALTER TABLE "Product" ALTER COLUMN "costPrice" SET DEFAULT 0;

-- The initial migration created this FK as ON DELETE SET NULL on a NOT NULL column.
ALTER TABLE "Product" DROP CONSTRAINT IF EXISTS "Product_categoryId_fkey";
ALTER TABLE "Product"
  ADD CONSTRAINT "Product_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Used by the expiry screens and the daily expiry job.
CREATE INDEX IF NOT EXISTS "Product_expiryDate_idx" ON "Product"("expiryDate");

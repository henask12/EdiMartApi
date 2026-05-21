-- AlterTable
ALTER TABLE "Product" ADD COLUMN "expiryDate" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Product_expiryDate_idx" ON "Product"("expiryDate");

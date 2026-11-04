-- Phase 6: suppliers, purchase orders, goods receipts, landed cost, bills, supplier returns.

ALTER TYPE "MovementType" ADD VALUE IF NOT EXISTS 'SUPPLIER_RETURN';

DO $$ BEGIN
  CREATE TYPE "PurchaseOrderStatus" AS ENUM (
    'DRAFT', 'APPROVED', 'SENT', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED', 'CANCELLED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "SupplierBillStatus" AS ENUM ('OPEN', 'PARTIAL', 'PAID', 'VOID');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "SupplierReturnStatus" AS ENUM ('DRAFT', 'SENT', 'COMPLETED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "Supplier" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "contactName" TEXT,
  "phone" TEXT,
  "telegram" TEXT,
  "email" TEXT,
  "address" TEXT,
  "tin" TEXT,
  "paymentTerms" TEXT,
  "leadTimeDays" INTEGER NOT NULL DEFAULT 7,
  "minimumOrder" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "currency" TEXT NOT NULL DEFAULT 'ETB',
  "notes" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Supplier_isActive_name_idx" ON "Supplier"("isActive", "name");

DO $$ BEGIN
  ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "SupplierProduct" (
  "id" TEXT NOT NULL,
  "supplierId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "supplierSku" TEXT,
  "packSize" INTEGER NOT NULL DEFAULT 1,
  "lastCost" DECIMAL(14,4) NOT NULL DEFAULT 0,
  "isPreferred" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SupplierProduct_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SupplierProduct_supplierId_productId_key" ON "SupplierProduct"("supplierId", "productId");
CREATE INDEX IF NOT EXISTS "SupplierProduct_productId_idx" ON "SupplierProduct"("productId");

DO $$ BEGIN
  ALTER TABLE "SupplierProduct" ADD CONSTRAINT "SupplierProduct_supplierId_fkey"
    FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "SupplierProduct" ADD CONSTRAINT "SupplierProduct_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "SupplierCostHistory" (
  "id" TEXT NOT NULL,
  "supplierId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "unitCost" DECIMAL(14,4) NOT NULL,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupplierCostHistory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SupplierCostHistory_supplierId_productId_createdAt_idx"
  ON "SupplierCostHistory"("supplierId", "productId", "createdAt");

DO $$ BEGIN
  ALTER TABLE "SupplierCostHistory" ADD CONSTRAINT "SupplierCostHistory_supplierId_fkey"
    FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "SupplierCostHistory" ADD CONSTRAINT "SupplierCostHistory_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "PurchaseOrder" (
  "id" TEXT NOT NULL,
  "poNumber" TEXT NOT NULL,
  "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
  "supplierId" TEXT NOT NULL,
  "notes" TEXT,
  "expectedAt" TIMESTAMP(3),
  "subtotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "createdByUserId" TEXT NOT NULL,
  "approvedByUserId" TEXT,
  "approvedAt" TIMESTAMP(3),
  "sentAt" TIMESTAMP(3),
  "closedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PurchaseOrder_poNumber_key" ON "PurchaseOrder"("poNumber");
CREATE INDEX IF NOT EXISTS "PurchaseOrder_status_createdAt_idx" ON "PurchaseOrder"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "PurchaseOrder_supplierId_status_idx" ON "PurchaseOrder"("supplierId", "status");

DO $$ BEGIN
  ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_supplierId_fkey"
    FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_approvedByUserId_fkey"
    FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "PurchaseOrderLine" (
  "id" TEXT NOT NULL,
  "purchaseOrderId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "quantityOrdered" DECIMAL(18,4) NOT NULL,
  "quantityReceived" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "unitCost" DECIMAL(14,4) NOT NULL,
  "lineTotal" DECIMAL(12,2) NOT NULL,
  CONSTRAINT "PurchaseOrderLine_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PurchaseOrderLine_purchaseOrderId_idx" ON "PurchaseOrderLine"("purchaseOrderId");
CREATE INDEX IF NOT EXISTS "PurchaseOrderLine_productId_idx" ON "PurchaseOrderLine"("productId");

DO $$ BEGIN
  ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_purchaseOrderId_fkey"
    FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "GoodsReceipt" (
  "id" TEXT NOT NULL,
  "receiptNumber" TEXT NOT NULL,
  "purchaseOrderId" TEXT,
  "supplierId" TEXT,
  "notes" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GoodsReceipt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "GoodsReceipt_receiptNumber_key" ON "GoodsReceipt"("receiptNumber");
CREATE INDEX IF NOT EXISTS "GoodsReceipt_purchaseOrderId_idx" ON "GoodsReceipt"("purchaseOrderId");
CREATE INDEX IF NOT EXISTS "GoodsReceipt_receivedAt_idx" ON "GoodsReceipt"("receivedAt");

DO $$ BEGIN
  ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_purchaseOrderId_fkey"
    FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "GoodsReceiptLine" (
  "id" TEXT NOT NULL,
  "goodsReceiptId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "purchaseOrderLineId" TEXT,
  "quantity" DECIMAL(18,4) NOT NULL,
  "unitCost" DECIMAL(14,4) NOT NULL,
  "landedUnitCost" DECIMAL(14,4),
  "locationId" TEXT NOT NULL,
  "stockBatchId" TEXT,
  "expiryDate" TIMESTAMP(3),
  "lotNumber" TEXT,
  CONSTRAINT "GoodsReceiptLine_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "GoodsReceiptLine_goodsReceiptId_idx" ON "GoodsReceiptLine"("goodsReceiptId");
CREATE INDEX IF NOT EXISTS "GoodsReceiptLine_productId_idx" ON "GoodsReceiptLine"("productId");

DO $$ BEGIN
  ALTER TABLE "GoodsReceiptLine" ADD CONSTRAINT "GoodsReceiptLine_goodsReceiptId_fkey"
    FOREIGN KEY ("goodsReceiptId") REFERENCES "GoodsReceipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "GoodsReceiptLine" ADD CONSTRAINT "GoodsReceiptLine_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "GoodsReceiptLine" ADD CONSTRAINT "GoodsReceiptLine_locationId_fkey"
    FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "LandedCost" (
  "id" TEXT NOT NULL,
  "goodsReceiptId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "description" TEXT,
  "amount" DECIMAL(12,2) NOT NULL,
  "allocateBy" TEXT NOT NULL DEFAULT 'VALUE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LandedCost_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "LandedCost_goodsReceiptId_idx" ON "LandedCost"("goodsReceiptId");

DO $$ BEGIN
  ALTER TABLE "LandedCost" ADD CONSTRAINT "LandedCost_goodsReceiptId_fkey"
    FOREIGN KEY ("goodsReceiptId") REFERENCES "GoodsReceipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "SupplierBill" (
  "id" TEXT NOT NULL,
  "billNumber" TEXT NOT NULL,
  "supplierId" TEXT NOT NULL,
  "purchaseOrderId" TEXT,
  "supplierInvoiceRef" TEXT,
  "status" "SupplierBillStatus" NOT NULL DEFAULT 'OPEN',
  "amountDue" DECIMAL(12,2) NOT NULL,
  "amountPaid" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "dueDate" TIMESTAMP(3),
  "notes" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SupplierBill_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SupplierBill_billNumber_key" ON "SupplierBill"("billNumber");
CREATE INDEX IF NOT EXISTS "SupplierBill_supplierId_status_idx" ON "SupplierBill"("supplierId", "status");
CREATE INDEX IF NOT EXISTS "SupplierBill_dueDate_idx" ON "SupplierBill"("dueDate");

DO $$ BEGIN
  ALTER TABLE "SupplierBill" ADD CONSTRAINT "SupplierBill_supplierId_fkey"
    FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "SupplierBill" ADD CONSTRAINT "SupplierBill_purchaseOrderId_fkey"
    FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "SupplierBill" ADD CONSTRAINT "SupplierBill_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "SupplierBillReceipt" (
  "id" TEXT NOT NULL,
  "supplierBillId" TEXT NOT NULL,
  "goodsReceiptId" TEXT NOT NULL,
  CONSTRAINT "SupplierBillReceipt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SupplierBillReceipt_supplierBillId_goodsReceiptId_key"
  ON "SupplierBillReceipt"("supplierBillId", "goodsReceiptId");

DO $$ BEGIN
  ALTER TABLE "SupplierBillReceipt" ADD CONSTRAINT "SupplierBillReceipt_supplierBillId_fkey"
    FOREIGN KEY ("supplierBillId") REFERENCES "SupplierBill"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "SupplierBillReceipt" ADD CONSTRAINT "SupplierBillReceipt_goodsReceiptId_fkey"
    FOREIGN KEY ("goodsReceiptId") REFERENCES "GoodsReceipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "SupplierPayment" (
  "id" TEXT NOT NULL,
  "supplierBillId" TEXT NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "method" "PaymentMethod" NOT NULL DEFAULT 'CASH',
  "reference" TEXT,
  "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupplierPayment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SupplierPayment_supplierBillId_idx" ON "SupplierPayment"("supplierBillId");

DO $$ BEGIN
  ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_supplierBillId_fkey"
    FOREIGN KEY ("supplierBillId") REFERENCES "SupplierBill"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "SupplierReturn" (
  "id" TEXT NOT NULL,
  "returnNumber" TEXT NOT NULL,
  "supplierId" TEXT NOT NULL,
  "status" "SupplierReturnStatus" NOT NULL DEFAULT 'DRAFT',
  "reason" TEXT,
  "notes" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SupplierReturn_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SupplierReturn_returnNumber_key" ON "SupplierReturn"("returnNumber");
CREATE INDEX IF NOT EXISTS "SupplierReturn_supplierId_status_idx" ON "SupplierReturn"("supplierId", "status");

DO $$ BEGIN
  ALTER TABLE "SupplierReturn" ADD CONSTRAINT "SupplierReturn_supplierId_fkey"
    FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "SupplierReturn" ADD CONSTRAINT "SupplierReturn_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "SupplierReturnLine" (
  "id" TEXT NOT NULL,
  "supplierReturnId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "quantity" DECIMAL(18,4) NOT NULL,
  "unitCost" DECIMAL(14,4) NOT NULL,
  "locationId" TEXT NOT NULL,
  "stockBatchId" TEXT,
  CONSTRAINT "SupplierReturnLine_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SupplierReturnLine_supplierReturnId_idx" ON "SupplierReturnLine"("supplierReturnId");
CREATE INDEX IF NOT EXISTS "SupplierReturnLine_productId_idx" ON "SupplierReturnLine"("productId");

DO $$ BEGIN
  ALTER TABLE "SupplierReturnLine" ADD CONSTRAINT "SupplierReturnLine_supplierReturnId_fkey"
    FOREIGN KEY ("supplierReturnId") REFERENCES "SupplierReturn"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "SupplierReturnLine" ADD CONSTRAINT "SupplierReturnLine_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "SupplierReturnLine" ADD CONSTRAINT "SupplierReturnLine_locationId_fkey"
    FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

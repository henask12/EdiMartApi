-- Reservation lifecycle dates
ALTER TABLE "Reservation" ADD COLUMN IF NOT EXISTS "reservedDate" TIMESTAMP(3);
ALTER TABLE "Reservation" ADD COLUMN IF NOT EXISTS "reservationEndDate" TIMESTAMP(3);

UPDATE "Reservation" SET "reservedDate" = "createdAt" WHERE "reservedDate" IS NULL;

ALTER TABLE "Reservation" ALTER COLUMN "reservedDate" SET NOT NULL;
ALTER TABLE "Reservation" ALTER COLUMN "reservedDate" SET DEFAULT CURRENT_TIMESTAMP;

-- EXPENSES_MANAGE permission
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'PermissionKey' AND e.enumlabel = 'EXPENSES_MANAGE'
  ) THEN
    ALTER TYPE "PermissionKey" ADD VALUE 'EXPENSES_MANAGE';
  END IF;
END $$;

-- Expenses
CREATE TABLE IF NOT EXISTS "Expense" (
  "id" TEXT NOT NULL,
  "detail" TEXT NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "expenseDate" TIMESTAMP(3) NOT NULL,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Expense_expenseDate_idx" ON "Expense"("expenseDate");

DO $$
BEGIN
  ALTER TABLE "Expense"
    ADD CONSTRAINT "Expense_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

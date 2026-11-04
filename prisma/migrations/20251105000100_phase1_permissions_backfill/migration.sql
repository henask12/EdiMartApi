-- Phase 1: one permission model. Additive only.

-- Manager approval PIN (bcrypt hash, never the PIN) with lockout bookkeeping.
ALTER TABLE "User" ADD COLUMN "pinHash" TEXT;
ALTER TABLE "User" ADD COLUMN "pinFailedAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "pinLockedUntil" TIMESTAMP(3);

-- Single-use manager approvals (token hash only).
CREATE TABLE "Approval" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "approverId" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Approval_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Approval_tokenHash_key" ON "Approval"("tokenHash");
CREATE INDEX "Approval_expiresAt_idx" ON "Approval"("expiresAt");

-- Owner-editable shop settings.
CREATE TABLE "StoreSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByUserId" TEXT,

    CONSTRAINT "StoreSetting_pkey" PRIMARY KEY ("key")
);

-- ---------------------------------------------------------------------------------------------
-- Backfill. Until now a role with no stored permission rows silently used the defaults in code
-- (and a built-in role with every box ticked off got the defaults back). The code fallback is
-- removed in this phase, so write those defaults out as real rows first. The lists below are the
-- defaults exactly as they were before Phase 1.
-- ---------------------------------------------------------------------------------------------
INSERT INTO "RolePermission" ("roleId", "permission")
SELECT r."id", d."permission"::"PermissionKey"
FROM "Role" r
JOIN (VALUES
  ('STORE_STAFF', 'PRODUCTS_VIEW'), ('STORE_STAFF', 'PRODUCTS_CREATE'), ('STORE_STAFF', 'PRODUCTS_EDIT'),
  ('STORE_STAFF', 'PRODUCTS_SELL'), ('STORE_STAFF', 'PRODUCTS_RESERVE'), ('STORE_STAFF', 'PRODUCTS_RESTOCK'),
  ('STORE_STAFF', 'PRODUCTS_EXPORT'), ('STORE_STAFF', 'CATEGORIES_MANAGE'), ('STORE_STAFF', 'PRODUCT_TYPES_MANAGE'),
  ('STORE_STAFF', 'STOCK_RECEIVE'), ('STORE_STAFF', 'STOCK_HISTORY_VIEW'), ('STORE_STAFF', 'SALES_CREATE'),
  ('STORE_STAFF', 'SALES_VIEW'), ('STORE_STAFF', 'SALES_EXPORT'), ('STORE_STAFF', 'RESERVATIONS_MANAGE'),
  ('STORE_STAFF', 'REPORTING_VIEW'),
  ('CASHIER', 'PRODUCTS_VIEW'), ('CASHIER', 'PRODUCTS_EDIT'), ('CASHIER', 'PRODUCTS_SELL'),
  ('CASHIER', 'PRODUCTS_RESERVE'), ('CASHIER', 'PRODUCTS_EXPORT'), ('CASHIER', 'SALES_CREATE'),
  ('CASHIER', 'SALES_VIEW'), ('CASHIER', 'SALES_EXPORT'), ('CASHIER', 'RESERVATIONS_MANAGE'),
  ('CASHIER', 'REPORTING_VIEW'),
  ('ONLINE_MANAGER', 'PRODUCTS_VIEW')
) AS d("role", "permission") ON d."role" = r."name"
WHERE NOT EXISTS (SELECT 1 FROM "RolePermission" rp WHERE rp."roleId" = r."id")
ON CONFLICT DO NOTHING;

-- New keys that mean exactly what an existing key already meant, so nobody loses access:
--   SALES_VIEW         -> SALES_VIEW_ALL  (the Sales page always showed every sale)
--   STOCK_HISTORY_VIEW -> STOCK_VIEW      (stock/expiry screens)
-- No sensitive key (adjust, void, refund, cost/profit, ...) is ever granted by this backfill:
-- the owner switches those on per role.
INSERT INTO "RolePermission" ("roleId", "permission")
SELECT "roleId", 'SALES_VIEW_ALL'::"PermissionKey" FROM "RolePermission"
WHERE "permission" = 'SALES_VIEW'::"PermissionKey"
ON CONFLICT DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permission")
SELECT "roleId", 'STOCK_VIEW'::"PermissionKey" FROM "RolePermission"
WHERE "permission" = 'STOCK_HISTORY_VIEW'::"PermissionKey"
ON CONFLICT DO NOTHING;

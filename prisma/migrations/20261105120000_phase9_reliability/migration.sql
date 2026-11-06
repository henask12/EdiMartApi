-- Phase 9: sessions, TOTP, offline sale ids, sync conflicts, pg_trgm search.

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "totpSecret" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "totpEnabled" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Sale" ADD COLUMN IF NOT EXISTS "clientSaleId" TEXT;
ALTER TABLE "Sale" ADD COLUMN IF NOT EXISTS "registerCode" TEXT;
ALTER TABLE "Sale" ADD COLUMN IF NOT EXISTS "createdOffline" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS "Sale_clientSaleId_key" ON "Sale"("clientSaleId");

CREATE TABLE IF NOT EXISTS "AuthSession" (
  "id" TEXT NOT NULL,
  "jti" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "userAgent" TEXT,
  "ip" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AuthSession_jti_key" ON "AuthSession"("jti");
CREATE INDEX IF NOT EXISTS "AuthSession_userId_revokedAt_idx" ON "AuthSession"("userId", "revokedAt");
CREATE INDEX IF NOT EXISTS "AuthSession_expiresAt_idx" ON "AuthSession"("expiresAt");

DO $$ BEGIN
  ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "SyncConflict" (
  "id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "clientRef" TEXT,
  "payload" JSONB NOT NULL,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "createdByUserId" TEXT,
  "resolvedByUserId" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "resolutionNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SyncConflict_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SyncConflict_status_createdAt_idx" ON "SyncConflict"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "SyncConflict_kind_status_idx" ON "SyncConflict"("kind", "status");
CREATE INDEX IF NOT EXISTS "SyncConflict_clientRef_idx" ON "SyncConflict"("clientRef");

DO $$ BEGIN
  ALTER TABLE "SyncConflict" ADD CONSTRAINT "SyncConflict_resolvedByUserId_fkey"
    FOREIGN KEY ("resolvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Trigram search for product name / Amharic name / brand / SKU.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS "Product_name_trgm_idx" ON "Product" USING GIN ("name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Product_nameAm_trgm_idx" ON "Product" USING GIN ("nameAm" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Product_brand_trgm_idx" ON "Product" USING GIN ("brand" gin_trgm_ops);

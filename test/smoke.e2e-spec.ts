import { execSync } from "child_process";
import { PrismaClient } from "@prisma/client";

describe("migrations on a fresh database", () => {
  const prisma = new PrismaClient();
  afterAll(() => prisma.$disconnect());

  it("creates every table and the stock constraints", async () => {
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public'`;
    const names = tables.map((t) => t.tablename);
    for (const t of ["User", "Sale", "DocumentCounter", "IdempotencyKey", "StockBatch"]) {
      expect(names).toContain(t);
    }
    const checks = await prisma.$queryRaw<{ conname: string }[]>`
      SELECT conname FROM pg_constraint WHERE contype = 'c'`;
    expect(checks.map((c) => c.conname)).toEqual(
      expect.arrayContaining([
        "InventoryItem_quantityOnHand_nonneg",
        "StockBatch_qtyRemaining_nonneg",
      ]),
    );
  });
});

describe("migration history vs schema.prisma", () => {
  // Legacy objects created by early migrations that the current schema no longer models.
  // Dropping them needs explicit owner approval (ground rule 2), so they are tolerated here
  // and listed in the Phase 0 report. Anything else is real drift and fails this test.
  const LEGACY = [
    /^ALTER TABLE "ProductImage" DROP CONSTRAINT "ProductImage_productId_fkey";$/,
    /^ALTER TABLE "ProductVariant" DROP CONSTRAINT "ProductVariant_productId_fkey";$/,
    /^ALTER TABLE "SaleLine" DROP CONSTRAINT "SaleLine_variantId_fkey";$/,
    // Phase 3 re-added Product.brand; prisma may emit either a multi-column DROP or per-column lines.
    /^ALTER TABLE "Product" DROP COLUMN "brand",$/,
    /^ALTER TABLE "Product" DROP COLUMN "dimensionsJson",$/,
    /^ALTER TABLE "Product" DROP COLUMN "taxRate",$/,
    /^ALTER TABLE "Product" DROP COLUMN "unitOfMeasure",$/,
    /^ALTER TABLE "Product" DROP COLUMN "weightGrams";$/,
    /^DROP COLUMN "brand",$/,
    /^DROP COLUMN "dimensionsJson",$/,
    /^DROP COLUMN "taxRate",$/,
    /^DROP COLUMN "unitOfMeasure",$/,
    /^DROP COLUMN "weightGrams";$/,
    /^ALTER TABLE "SaleLine" DROP COLUMN "variantId";$/,
    /^DROP TABLE "ProductImage";$/,
    /^DROP TABLE "ProductVariant";$/,
  ];

  it("has no drift beyond the known legacy leftovers", () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required for the drift check");
    }
    let out = "";
    try {
      out = execSync(
        `node node_modules/prisma/build/index.js migrate diff --from-url "${databaseUrl}" --to-schema-datamodel prisma/schema.prisma --script`,
        { env: process.env, encoding: "utf8" },
      );
    } catch (e) {
      out = String((e as { stdout?: string }).stdout ?? e);
    }
    // Migration history still creates legacy Product.brand / taxRate / etc.; schema.prisma also
    // re-added Product.brand in Phase 3, so a "DROP COLUMN brand" leftover is no longer expected
    // when the live schema keeps brand. Keep LEGACY list for the still-orphaned objects.
    const unexpected = out
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("--") && !LEGACY.some((re) => re.test(l)));
    expect(unexpected).toEqual([]);
  });
});

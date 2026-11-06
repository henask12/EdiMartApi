import { mkdirSync, mkdtempSync, writeFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { PrismaClient } from "@prisma/client";
import { LocalStorageDriver } from "../src/storage/local-storage.driver";
import { migrateUploads } from "../src/storage/migrate-uploads";
import { createProduct, resetData, seedBasics } from "./helpers";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

describe("migrate-uploads", () => {
  const prisma = new PrismaClient();
  afterAll(() => prisma.$disconnect());

  it("moves legacy files into products/ and proofs/, is repeatable, and reports problems", async () => {
    await resetData(prisma);
    const basics = await seedBasics(prisma);
    const dir = mkdtempSync(join(tmpdir(), "edimart-legacy-"));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "product.png"), PNG);
    writeFileSync(join(dir, "proof.png"), PNG);
    writeFileSync(join(dir, "evil.png"), "<script>alert(1)</script>");

    const { product } = await createProduct(prisma, basics.location.id, { stock: 1 });
    await prisma.product.update({ where: { id: product.id }, data: { imagePath: "/uploads/product.png" } });
    const sale = await prisma.sale.create({
      data: { saleNumber: "S-1", subtotal: 0, grandTotal: 0, createdByUserId: basics.users.OWNER.id },
    });
    await prisma.saleAttachment.createMany({
      data: [
        { saleId: sale.id, imagePath: "/uploads/proof.png" },
        { saleId: sale.id, imagePath: "/uploads/gone.png" },
        { saleId: sale.id, imagePath: "/uploads/evil.png" },
        { saleId: sale.id, imagePath: "/uploads/../../secret.txt" },
      ],
    });
    const driver = new LocalStorageDriver(dir, "http://api.test", "s");

    const dry = await migrateUploads(prisma, driver, { legacyDir: dir, apply: false });
    expect(dry.moved).toBe(2);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).imagePath).toBe("/uploads/product.png");
    expect(existsSync(join(dir, "proofs", "proof.png"))).toBe(false);

    const real = await migrateUploads(prisma, driver, { legacyDir: dir, apply: true });
    expect(real.moved).toBe(2);
    expect(real.missingFiles.map((m) => m.path).sort()).toEqual(["/uploads/../../secret.txt", "/uploads/gone.png"]);
    expect(real.notImages.map((m) => m.path)).toEqual(["/uploads/evil.png"]);

    expect((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).imagePath).toBe(
      "/uploads/products/product.png",
    );
    const moved = await prisma.saleAttachment.findFirstOrThrow({ where: { imagePath: { startsWith: "/uploads/proofs/" } } });
    expect(moved.imagePath).toBe("/uploads/proofs/proof.png");
    expect(existsSync(join(dir, "proofs", "proof.png"))).toBe(true);
    expect(existsSync(join(dir, "products", "product.png"))).toBe(true);
    expect(existsSync(join(dir, "product.png"))).toBe(true); // originals are never deleted

    const again = await migrateUploads(prisma, driver, { legacyDir: dir, apply: true });
    expect(again.moved).toBe(0);
    expect(again.alreadyMigrated).toBe(2);
  });
});

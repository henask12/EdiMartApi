import { Prisma } from "@prisma/client";
import request from "supertest";
import { reconcileStock } from "../src/inventory/reconciliation";
import { TestApp, bearer, close, createProduct, createTestApp, login, resetData, seedBasics } from "./helpers";

describe("stock integrity", () => {
  let t: TestApp;
  let locationId: string;
  let ownerToken: string;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => close(t));
  beforeEach(async () => {
    await resetData(t.prisma);
    const basics = await seedBasics(t.prisma);
    locationId = basics.location.id;
    ownerToken = await login(t, "owner@test.local");
  });

  describe("reconciliation report", () => {
    it("is empty when stock agrees with the ledger", async () => {
      await createProduct(t.prisma, locationId, { stock: 10 });
      const report = await reconcileStock(t.prisma);
      expect(report.totals.inventoryRows).toBe(1);
      expect(report.findings).toEqual([]);
    });

    it("reports on-hand that the ledger cannot explain - and does not fix it", async () => {
      const { product, inventory } = await createProduct(t.prisma, locationId, { stock: 10 });
      // someone edits the number directly, with no movement
      await t.prisma.inventoryItem.update({ where: { id: inventory.id }, data: { quantityOnHand: 14 } });

      const report = await reconcileStock(t.prisma);
      expect(report.totals.withLedgerDrift).toBe(1);
      expect(report.findings[0]).toMatchObject({
        productId: product.id,
        onHand: "14",
        ledgerSum: "10",
        drift: "4",
      });
      const after = await t.prisma.inventoryItem.findUniqueOrThrow({ where: { id: inventory.id } });
      expect(after.quantityOnHand.toString()).toBe("14");
    });

    it("ignores reservation movements when summing the ledger", async () => {
      const { product } = await createProduct(t.prisma, locationId, { stock: 10 });
      const res = await request(t.http())
        .post("/reservations")
        .set(bearer(ownerToken))
        .send({ productId: product.id, quantity: "3" });
      expect(res.status).toBe(201);
      expect((await reconcileStock(t.prisma)).findings).toEqual([]);
    });

    it("flags batches that claim more than is on hand, and over-reservation", async () => {
      const { product, inventory } = await createProduct(t.prisma, locationId, { stock: 5 });
      await t.prisma.stockBatch.updateMany({ where: { productId: product.id }, data: { qtyRemaining: 5 } });
      await t.prisma.stockBatch.create({
        data: { productId: product.id, qtyReceived: 3, qtyRemaining: 3, unitCost: 1 },
      });
      const owner = await t.prisma.user.findFirstOrThrow();
      await t.prisma.reservation.create({ data: { productId: product.id, quantity: 9, createdByUserId: owner.id } });

      const report = await reconcileStock(t.prisma);
      const row = report.findings.find((f) => f.inventoryItemId === inventory.id)!;
      expect(row.batchesExceedOnHand).toBe(true);
      expect(row.overReserved).toBe(true);
    });

    it("notices a broken before/after chain in the movement history", async () => {
      const { inventory } = await createProduct(t.prisma, locationId, { stock: 5 });
      await t.prisma.stockMovement.create({
        data: {
          inventoryItemId: inventory.id,
          type: "ADJUSTMENT",
          qtyDelta: 0,
          beforeOnHand: 99, // should have been 5
          afterOnHand: 99,
        },
      });
      const report = await reconcileStock(t.prisma);
      expect(report.totals.withChainBreaks).toBe(1);
    });
  });

  describe("negative stock", () => {
    it("the database itself refuses a negative on-hand quantity", async () => {
      const { inventory } = await createProduct(t.prisma, locationId, { stock: 2 });
      await expect(
        t.prisma.inventoryItem.update({ where: { id: inventory.id }, data: { quantityOnHand: -1 } }),
      ).rejects.toThrow(/nonneg|check constraint/i);
    });

    it("the database refuses a negative batch quantity", async () => {
      const { product } = await createProduct(t.prisma, locationId, { stock: 2 });
      await expect(
        t.prisma.stockBatch.updateMany({ where: { productId: product.id }, data: { qtyRemaining: -1 } }),
      ).rejects.toThrow(/nonneg|check constraint/i);
    });

    it("an adjustment cannot push stock below zero", async () => {
      const { product } = await createProduct(t.prisma, locationId, { stock: 2 });
      const res = await request(t.http())
        .post("/inventory/adjust")
        .set(bearer(ownerToken))
        .send({ productId: product.id, quantityDelta: "-3" });
      expect(res.status).toBe(400);
      const inv = await t.prisma.inventoryItem.findFirstOrThrow({ where: { productId: product.id } });
      expect(inv.quantityOnHand.toString()).toBe("2");
    });

    it("parallel negative adjustments cannot jointly overdraw the shelf", async () => {
      const { product } = await createProduct(t.prisma, locationId, { stock: 5 });
      const results = await Promise.all(
        Array.from({ length: 8 }, () =>
          request(t.http())
            .post("/inventory/adjust")
            .set(bearer(ownerToken))
            .send({ productId: product.id, quantityDelta: "-1" }),
        ),
      );
      expect(results.filter((r) => r.status === 201)).toHaveLength(5);
      expect(results.filter((r) => r.status === 400)).toHaveLength(3);
      const inv = await t.prisma.inventoryItem.findFirstOrThrow({ where: { productId: product.id } });
      expect(inv.quantityOnHand.toString()).toBe("0");
      expect((await reconcileStock(t.prisma)).findings).toEqual([]);
    });

    it("write-offs take stock from the oldest batch first, keeping batches consistent", async () => {
      const { product } = await createProduct(t.prisma, locationId, { stock: 4, expiry: "2031-01-01" });
      const res = await request(t.http())
        .post("/inventory/adjust")
        .set(bearer(ownerToken))
        .send({ productId: product.id, quantityDelta: "-3", notes: "damaged" });
      expect(res.status).toBe(201);
      const batch = await t.prisma.stockBatch.findFirstOrThrow({ where: { productId: product.id } });
      expect(batch.qtyRemaining.toString()).toBe("1");
      expect((await reconcileStock(t.prisma)).findings).toEqual([]);
    });
  });

  it("opening stock created through the API is fully ledgered", async () => {
    const category = await t.prisma.category.create({ data: { name: "Skincare" } });
    const res = await request(t.http())
      .post("/products")
      .set(bearer(ownerToken))
      .send({ name: "Serum", categoryId: category.id, sellingPrice: "1200", costPrice: "800", initialQuantity: "6" });
    expect(res.status).toBe(201);
    expect(res.body.onHand).toBe("6");
    expect((await reconcileStock(t.prisma)).findings).toEqual([]);
    const batches = await t.prisma.stockBatch.findMany();
    expect(batches).toHaveLength(1);
    expect(new Prisma.Decimal(batches[0].qtyRemaining).toString()).toBe("6");
  });
});

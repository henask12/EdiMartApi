import { Prisma } from "@prisma/client";
import request from "supertest";
import { reconcileStock } from "../src/inventory/reconciliation";
import { businessDateString } from "../src/common/business-time";
import {
  TestApp,
  addBatch,
  bearer,
  checkout,
  close,
  createProduct,
  createTestApp,
  login,
  resetData,
  seedBasics,
} from "./helpers";

describe("checkout", () => {
  let t: TestApp;
  let token: string;
  let locationId: string;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => close(t));

  beforeEach(async () => {
    await resetData(t.prisma);
    const basics = await seedBasics(t.prisma);
    locationId = basics.location.id;
    token = await login(t, basics.users.CASHIER.email);
  });

  const sale = (productId: string, quantity = "1") => ({ lines: [{ productId, quantity }] });

  it("10 parallel checkouts for the last unit produce exactly one sale", async () => {
    const { product } = await createProduct(t.prisma, locationId, { stock: 1 });

    const results = await Promise.all(
      Array.from({ length: 10 }, () => checkout(t, token, sale(product.id))),
    );

    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(9);
    const loser = results.find((r) => r.status === 409)!;
    expect(loser.body.message).toContain(product.name);

    expect(await t.prisma.sale.count()).toBe(1);
    const inv = await t.prisma.inventoryItem.findFirstOrThrow({ where: { productId: product.id } });
    expect(inv.quantityOnHand.toString()).toBe("0");
    const report = await reconcileStock(t.prisma);
    expect(report.findings).toEqual([]);
  });

  it("returns the original sale when the same Idempotency-Key is repeated", async () => {
    const { product } = await createProduct(t.prisma, locationId, { stock: 5 });
    const key = "retry-key-0001";

    const first = await checkout(t, token, sale(product.id, "2"), key);
    const second = await checkout(t, token, sale(product.id, "2"), key);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.replayed).toBe(true);
    expect(second.body.sale.id).toBe(first.body.sale.id);
    expect(await t.prisma.sale.count()).toBe(1);
    const inv = await t.prisma.inventoryItem.findFirstOrThrow({ where: { productId: product.id } });
    expect(inv.quantityOnHand.toString()).toBe("3");
  });

  it("returns one sale when two identical requests with the same key race", async () => {
    const { product } = await createProduct(t.prisma, locationId, { stock: 5 });
    const results = await Promise.all(
      Array.from({ length: 4 }, () => checkout(t, token, sale(product.id), "race-key-000001")),
    );
    expect(results.every((r) => r.status === 201)).toBe(true);
    expect(new Set(results.map((r) => r.body.sale.id)).size).toBe(1);
    expect(await t.prisma.sale.count()).toBe(1);
  });

  it("rejects an Idempotency-Key reused for a different sale", async () => {
    const { product } = await createProduct(t.prisma, locationId, { stock: 5 });
    await checkout(t, token, sale(product.id, "1"), "reuse-key-00001");
    const res = await checkout(t, token, sale(product.id, "2"), "reuse-key-00001");
    expect(res.status).toBe(409);
  });

  it("requires the Idempotency-Key header", async () => {
    const { product } = await createProduct(t.prisma, locationId, { stock: 5 });
    const res = await request(t.http()).post("/sales/checkout").set(bearer(token)).send(sale(product.id));
    expect(res.status).toBe(400);
  });

  it("records the payment method and reference that the client sent", async () => {
    const { product } = await createProduct(t.prisma, locationId, { stock: 5, price: 250 });
    const res = await checkout(t, token, {
      ...sale(product.id, "2"),
      paymentMethod: "TELEBIRR",
      paymentReference: "TXN-12345",
    });
    expect(res.status).toBe(201);
    expect(res.body.sale.payments).toEqual([
      expect.objectContaining({ method: "TELEBIRR", amount: "500.00", reference: "TXN-12345" }),
    ]);
    const list = await request(t.http()).get("/sales").set(bearer(token));
    expect(list.body.items[0].payments[0].method).toBe("TELEBIRR");
  });

  it("defaults to cash and rejects an unknown method", async () => {
    const { product } = await createProduct(t.prisma, locationId, { stock: 5 });
    const ok = await checkout(t, token, sale(product.id));
    expect(ok.body.sale.payments[0].method).toBe("CASH");
    const bad = await checkout(t, token, { ...sale(product.id), paymentMethod: "BITCOIN" });
    expect(bad.status).toBe(400);
  });

  it("numbers sales per business day with no duplicates under concurrency", async () => {
    const { product } = await createProduct(t.prisma, locationId, { stock: 50 });
    const results = await Promise.all(
      Array.from({ length: 8 }, () => checkout(t, token, sale(product.id))),
    );
    expect(results.every((r) => r.status === 201)).toBe(true);
    const numbers = results.map((r) => r.body.sale.saleNumber as string).sort();
    const day = businessDateString().replace(/-/g, "");
    expect(numbers).toEqual(
      Array.from({ length: 8 }, (_, i) => `SALE-${day}-${String(i + 1).padStart(4, "0")}`),
    );
  });

  it("continues after the highest number already issued today by the old scheme", async () => {
    const { product } = await createProduct(t.prisma, locationId, { stock: 5 });
    const day = businessDateString().replace(/-/g, "");
    const cashier = await t.prisma.user.findFirstOrThrow();
    await t.prisma.sale.create({
      data: {
        saleNumber: `SALE-${day}-0007`,
        subtotal: 0,
        grandTotal: 0,
        createdByUserId: cashier.id,
      },
    });
    const res = await checkout(t, token, sale(product.id));
    expect(res.status).toBe(201);
    expect(res.body.sale.saleNumber).toBe(`SALE-${day}-0008`);
  });

  it("takes stock from the batch that expires first and keeps batches in step", async () => {
    const { product, inventory } = await createProduct(t.prisma, locationId, {
      stock: 4,
      expiry: "2030-06-01",
    });
    const early = await addBatch(
      t.prisma, inventory.id, product.id, new Prisma.Decimal(3), "2029-01-01", 60, new Prisma.Decimal(4),
    );
    await t.prisma.inventoryItem.update({
      where: { id: inventory.id },
      data: { quantityOnHand: 7 },
    });

    const res = await checkout(t, token, sale(product.id, "5"));
    expect(res.status).toBe(201);

    const batches = await t.prisma.stockBatch.findMany({
      where: { productId: product.id },
      orderBy: { expiryDate: "asc" },
    });
    expect(batches.map((b) => b.qtyRemaining.toString())).toEqual(["0", "2"]);
    expect(batches[0].id).toBe(early.id);
    const saleMovements = await t.prisma.stockMovement.findMany({ where: { type: "SALE" } });
    expect(saleMovements.map((m) => m.qtyDelta.toString()).sort()).toEqual(["-2", "-3"]);
    expect((await reconcileStock(t.prisma)).findings).toEqual([]);
  });

  it("cannot oversell by splitting one product over two cart lines", async () => {
    const { product } = await createProduct(t.prisma, locationId, { stock: 5 });
    const res = await checkout(t, token, {
      lines: [
        { productId: product.id, quantity: "3" },
        { productId: product.id, quantity: "3" },
      ],
    });
    expect(res.status).toBe(409);
    expect(await t.prisma.sale.count()).toBe(0);
  });

  it("does not sell stock that is reserved for someone else", async () => {
    const { product } = await createProduct(t.prisma, locationId, { stock: 5 });
    const owner = await t.prisma.user.findFirstOrThrow({ where: { email: "owner@test.local" } });
    await t.prisma.reservation.create({
      data: { productId: product.id, quantity: 4, createdByUserId: owner.id },
    });
    const res = await checkout(t, token, sale(product.id, "2"));
    expect(res.status).toBe(409);
    expect(res.body.message).toContain("available 1");
  });

  it("completes a reservation as a sale exactly once", async () => {
    const { product } = await createProduct(t.prisma, locationId, { stock: 5 });
    const owner = await t.prisma.user.findFirstOrThrow({ where: { email: "owner@test.local" } });
    const reservation = await t.prisma.reservation.create({
      data: { productId: product.id, quantity: 2, createdByUserId: owner.id },
    });
    const ownerToken = await login(t, "owner@test.local");

    // Two clicks at once: both succeed with the very same sale (idempotent), stock drops once.
    const [a, b] = await Promise.all([
      request(t.http()).post(`/reservations/${reservation.id}/complete`).set(bearer(ownerToken)),
      request(t.http()).post(`/reservations/${reservation.id}/complete`).set(bearer(ownerToken)),
    ]);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(a.body.sale.id).toBe(b.body.sale.id);
    // Once it is completed, a later attempt is refused.
    const later = await request(t.http())
      .post(`/reservations/${reservation.id}/complete`)
      .set(bearer(ownerToken));
    expect(later.status).toBe(400);
    expect(await t.prisma.sale.count()).toBe(1);
    const inv = await t.prisma.inventoryItem.findFirstOrThrow({ where: { productId: product.id } });
    expect(inv.quantityOnHand.toString()).toBe("3");
    expect((await t.prisma.reservation.findUniqueOrThrow({ where: { id: reservation.id } })).status).toBe(
      "COMPLETED",
    );
  });

  it("rejects non-positive and malformed quantities with 400", async () => {
    const { product } = await createProduct(t.prisma, locationId, { stock: 5 });
    expect((await checkout(t, token, sale(product.id, "0"))).status).toBe(400);
    expect((await checkout(t, token, sale(product.id, "abc"))).status).toBe(400);
  });
});

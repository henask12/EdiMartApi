import request from "supertest";
import { ReservationsService } from "../src/reservations/reservations.service";
import { reconcileStock } from "../src/inventory/reconciliation";
import { TestApp, bearer, checkout, close, createProduct, createTestApp, login, resetData, seedBasics } from "./helpers";

describe("reservations", () => {
  let t: TestApp;
  let ownerToken: string;
  let cashierToken: string;
  let ownerId: string;
  let locationId: string;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => close(t));
  beforeEach(async () => {
    await resetData(t.prisma);
    const basics = await seedBasics(t.prisma);
    locationId = basics.location.id;
    ownerId = basics.users.OWNER.id;
    ownerToken = await login(t, "owner@test.local");
    cashierToken = await login(t, "cashier@test.local");
  });

  const reserve = (productId: string, quantity: string, extra: Record<string, unknown> = {}) =>
    request(t.http()).post("/reservations").set(bearer(ownerToken)).send({ productId, quantity, ...extra });

  const available = async (productId: string) => {
    const res = await request(t.http()).get(`/products/${productId}`).set(bearer(ownerToken));
    return res.body.available as string;
  };

  it("reserving holds stock; two reservations cannot both claim the last unit", async () => {
    const { product } = await createProduct(t.prisma, locationId, { stock: 1 });
    const results = await Promise.all([reserve(product.id, "1"), reserve(product.id, "1"), reserve(product.id, "1")]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 400, 400]);
    expect(await available(product.id)).toBe("0");
  });

  it("rejects an expiry that is invalid or already in the past", async () => {
    const { product } = await createProduct(t.prisma, locationId, { stock: 5 });
    expect((await reserve(product.id, "1", { expiresAt: "not a date" })).status).toBe(400);
    expect((await reserve(product.id, "1", { expiresAt: "2020-01-01T00:00:00Z" })).status).toBe(400);
    const future = new Date(Date.now() + 3600_000).toISOString();
    expect((await reserve(product.id, "1", { expiresAt: future })).status).toBe(201);
  });

  it("an expired reservation stops counting as reserved immediately, before the sweep runs", async () => {
    const { product } = await createProduct(t.prisma, locationId, { stock: 5 });
    await t.prisma.reservation.create({
      data: {
        productId: product.id,
        quantity: 4,
        createdByUserId: ownerId,
        expiresAt: new Date(Date.now() - 60_000),
      },
    });
    expect(await available(product.id)).toBe("5");
    // ...so the stock can be sold even though the row still says RESERVED.
    const res = await checkout(t, cashierToken, { lines: [{ productId: product.id, quantity: "5" }] });
    expect(res.status).toBe(201);
  });

  it("the sweep marks due reservations EXPIRED and writes a RELEASE_RESERVE movement", async () => {
    const { product } = await createProduct(t.prisma, locationId, { stock: 5 });
    const due = await t.prisma.reservation.create({
      data: { productId: product.id, quantity: 2, createdByUserId: ownerId, expiresAt: new Date(Date.now() - 1000) },
    });
    const later = await t.prisma.reservation.create({
      data: { productId: product.id, quantity: 1, createdByUserId: ownerId, expiresAt: new Date(Date.now() + 3600_000) },
    });
    const open = await t.prisma.reservation.create({
      data: { productId: product.id, quantity: 1, createdByUserId: ownerId },
    });

    const service = t.app.get(ReservationsService);
    expect(await service.expireDue()).toBe(1);

    const status = async (id: string) => (await t.prisma.reservation.findUniqueOrThrow({ where: { id } })).status;
    expect(await status(due.id)).toBe("EXPIRED");
    expect(await status(later.id)).toBe("RESERVED");
    expect(await status(open.id)).toBe("RESERVED");

    const released = await t.prisma.stockMovement.findMany({ where: { type: "RELEASE_RESERVE", refId: due.id } });
    expect(released).toHaveLength(1);
    expect(released[0].qtyDelta.toString()).toBe("-2");
    expect(released[0].createdByUserId).toBeNull();
    expect(released[0].notes).toBe("Reservation expired");
    const audit = await t.prisma.auditLog.findMany({ where: { action: "EXPIRE_RESERVE", entityId: due.id } });
    expect(audit).toHaveLength(1);

    // Running it again changes nothing.
    expect(await service.expireDue()).toBe(0);
    expect(await t.prisma.stockMovement.count({ where: { type: "RELEASE_RESERVE", refId: due.id } })).toBe(1);
    expect((await reconcileStock(t.prisma)).findings).toEqual([]);
  });

  it("an expired reservation can no longer be completed as a sale", async () => {
    const { product } = await createProduct(t.prisma, locationId, { stock: 5 });
    const r = await t.prisma.reservation.create({
      data: { productId: product.id, quantity: 2, createdByUserId: ownerId, expiresAt: new Date(Date.now() - 1000) },
    });
    await t.app.get(ReservationsService).expireDue();
    const res = await request(t.http()).post(`/reservations/${r.id}/complete`).set(bearer(ownerToken));
    expect(res.status).toBe(400);
  });
});

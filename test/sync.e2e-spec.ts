import { randomUUID } from "crypto";
import request from "supertest";
import {
  TestApp,
  bearer,
  close,
  createProduct,
  createTestApp,
  login,
  resetData,
  seedBasics,
} from "./helpers";

describe("offline sync (Phase 9)", () => {
  let t: TestApp;
  let locationId: string;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => close(t));
  beforeEach(async () => {
    await resetData(t.prisma);
    const seeded = await seedBasics(t.prisma);
    locationId = seeded.location.id;
  });

  it("offline checkout with clientSaleId is idempotent on replay", async () => {
    const { product } = await createProduct(t.prisma, locationId, { stock: 10, price: 50 });
    const token = await login(t, "cashier@test.local");
    const clientSaleId = randomUUID();
    const body = {
      lines: [{ productId: product.id, quantity: "1" }],
      paymentMethod: "CASH",
      clientSaleId,
      createdOffline: true,
      registerCode: "REGISTER-1",
    };
    const key = `offline-${clientSaleId}`;

    const first = await request(t.http())
      .post("/sales/checkout")
      .set(bearer(token))
      .set("Idempotency-Key", key)
      .send(body);
    expect(first.status).toBe(201);
    expect(first.body.sale.clientSaleId).toBe(clientSaleId);
    expect(first.body.sale.createdOffline).toBe(true);
    expect(first.body.sale.saleNumber).toMatch(/SALE-\d{8}-REGISTER-1-\d{4}/);
    expect(first.body.replayed).toBe(false);

    const second = await request(t.http())
      .post("/sales/checkout")
      .set(bearer(token))
      .set("Idempotency-Key", key)
      .send(body);
    expect(second.status).toBe(201);
    expect(second.body.replayed).toBe(true);
    expect(second.body.sale.id).toBe(first.body.sale.id);

    const conflictKey = `offline-other-${clientSaleId}`;
    const conflict = await request(t.http())
      .post("/sales/checkout")
      .set(bearer(token))
      .set("Idempotency-Key", conflictKey)
      .send({ ...body, lines: [{ productId: product.id, quantity: "2" }] });
    expect(conflict.status).toBe(409);
  });

  it("creates and lists sync conflicts", async () => {
    const cashier = await login(t, "cashier@test.local");
    const created = await request(t.http())
      .post("/sync/conflicts")
      .set(bearer(cashier))
      .send({
        kind: "CHECKOUT",
        clientRef: randomUUID(),
        payload: { lines: [] },
        errorCode: "STOCK_NEGATIVE",
        errorMessage: "Not enough stock",
      });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe("OPEN");

    const owner = await login(t, "owner@test.local");
    const list = await request(t.http())
      .get("/sync/conflicts?status=OPEN")
      .set(bearer(owner));
    expect(list.status).toBe(200);
    expect(list.body.total).toBeGreaterThanOrEqual(1);

    const resolved = await request(t.http())
      .post(`/sync/conflicts/${created.body.id}/resolve`)
      .set(bearer(owner))
      .send({ note: "Adjusted stock and re-synced" });
    expect(resolved.status).toBe(201);
    expect(resolved.body.status).toBe("RESOLVED");
  });
});

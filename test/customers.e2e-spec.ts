import request from "supertest";
import {
  TestApp,
  bearer,
  checkout,
  close,
  createProduct,
  createTestApp,
  login,
  resetData,
  seedBasics,
} from "./helpers";

describe("customers (phase 7)", () => {
  let t: TestApp;
  let ownerToken: string;
  let staffToken: string;
  let locationId: string;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => close(t));

  beforeEach(async () => {
    await resetData(t.prisma);
    const basics = await seedBasics(t.prisma);
    locationId = basics.location.id;
    ownerToken = await login(t, basics.users.OWNER.email);
    staffToken = await login(t, basics.users.STORE_STAFF.email);
  });

  it("creates a customer and normalizes Ethiopian phone numbers", async () => {
    const res = await request(t.http())
      .post("/customers")
      .set(bearer(ownerToken))
      .send({ name: "Abebe", phone: "0911223344" });
    expect(res.status).toBe(201);
    expect(res.body.phone).toBe("+251911223344");
    expect(res.body.creditLimit).toBe("0.00");
    expect(res.body.creditBalance).toBe("0.00");
    expect(res.body.storeCreditBalance).toBe("0.00");

    const again = await request(t.http())
      .post("/customers")
      .set(bearer(ownerToken))
      .send({ name: "Dup", phone: "911223344" });
    expect(again.status).toBe(400);

    const bad = await request(t.http())
      .post("/customers")
      .set(bearer(ownerToken))
      .send({ name: "Bad", phone: "0111223344" });
    expect(bad.status).toBe(400);
  });

  it("returns a profile with spend stats after a sale", async () => {
    const create = await request(t.http())
      .post("/customers")
      .set(bearer(ownerToken))
      .send({ name: "Sara", phone: "0911000001" });
    expect(create.status).toBe(201);
    const customerId = create.body.id as string;

    const { product } = await createProduct(t.prisma, locationId, { stock: 5, price: 200 });
    const sale = await checkout(t, ownerToken, {
      lines: [{ productId: product.id, quantity: "1" }],
      customerId,
    });
    expect(sale.status).toBe(201);

    const profile = await request(t.http())
      .get(`/customers/${customerId}`)
      .set(bearer(ownerToken));
    expect(profile.status).toBe(200);
    expect(profile.body.stats.saleCount).toBe(1);
    expect(profile.body.stats.totalSpend).toBe("200.00");
    expect(profile.body.stats.lastVisit).toBeTruthy();
    expect(profile.body.loyaltyPoints).toBeGreaterThanOrEqual(1);
  });

  it("sets credit limit, charges account at checkout, and records a repayment", async () => {
    const create = await request(t.http())
      .post("/customers")
      .set(bearer(staffToken))
      .send({ name: "Credit", phone: "0911000002" });
    const customerId = create.body.id as string;

    const limit = await request(t.http())
      .post(`/customers/${customerId}/credit-limit`)
      .set(bearer(staffToken))
      .send({ creditLimit: "500.00" });
    expect(limit.status).toBe(201);
    expect(limit.body.creditLimit).toBe("500.00");

    const { product } = await createProduct(t.prisma, locationId, { stock: 5, price: 100 });
    const sale = await checkout(t, staffToken, {
      lines: [{ productId: product.id, quantity: "1" }],
      customerId,
      payments: [{ method: "CUSTOMER_ACCOUNT", amount: "100.00" }],
    });
    expect(sale.status).toBe(201);

    const afterSale = await request(t.http())
      .get(`/customers/${customerId}`)
      .set(bearer(staffToken));
    expect(afterSale.body.creditBalance).toBe("100.00");

    const repay = await request(t.http())
      .post(`/customers/${customerId}/repay`)
      .set(bearer(staffToken))
      .send({ amount: "40.00", method: "CASH" });
    expect(repay.status).toBe(201);
    expect(repay.body.creditBalance).toBe("60.00");

    const ledger = await request(t.http())
      .get(`/customers/${customerId}/ledger`)
      .set(bearer(staffToken));
    expect(ledger.status).toBe(200);
    expect(ledger.body.items.some((e: { kind: string }) => e.kind === "REPAYMENT")).toBe(true);
    expect(ledger.body.items.some((e: { kind: string }) => e.kind === "SALE_CREDIT")).toBe(true);
  });

  it("issues store credit on return and redeems it at POS", async () => {
    const create = await request(t.http())
      .post("/customers")
      .set(bearer(ownerToken))
      .send({ name: "Returnee", phone: "0911000003" });
    const customerId = create.body.id as string;

    const { product } = await createProduct(t.prisma, locationId, { stock: 5, price: 150 });
    const sold = await checkout(t, ownerToken, {
      lines: [{ productId: product.id, quantity: "1" }],
      customerId,
      paymentMethod: "CASH",
    });
    expect(sold.status).toBe(201);
    const saleId = sold.body.sale.id as string;
    const lineId = sold.body.sale.lines[0].id as string;

    const ret = await request(t.http())
      .post(`/sales/${saleId}/return`)
      .set(bearer(ownerToken))
      .send({
        reason: "Changed mind",
        condition: "RESTOCK",
        refundMethod: "STORE_CREDIT",
        lines: [{ saleLineId: lineId, quantity: "1" }],
      });
    expect(ret.status).toBe(201);

    const afterReturn = await request(t.http())
      .get(`/customers/${customerId}`)
      .set(bearer(ownerToken));
    expect(afterReturn.body.storeCreditBalance).toBe("150.00");

    const { product: p2 } = await createProduct(t.prisma, locationId, {
      stock: 5,
      price: 80,
      name: "Second",
    });
    const redeem = await checkout(t, ownerToken, {
      lines: [{ productId: p2.id, quantity: "1" }],
      customerId,
      payments: [
        { method: "STORE_CREDIT", amount: "80.00" },
      ],
    });
    expect(redeem.status).toBe(201);

    const afterRedeem = await request(t.http())
      .get(`/customers/${customerId}`)
      .set(bearer(ownerToken));
    expect(afterRedeem.body.storeCreditBalance).toBe("70.00");
  });

  it("adjusts store credit and returns a printable statement", async () => {
    const create = await request(t.http())
      .post("/customers")
      .set(bearer(ownerToken))
      .send({ name: "Adjust", phone: "0911000004" });
    const customerId = create.body.id as string;

    const adj = await request(t.http())
      .post(`/customers/${customerId}/adjust-store-credit`)
      .set(bearer(ownerToken))
      .send({ amount: "25.00", notes: "Goodwill" });
    expect(adj.status).toBe(201);
    expect(adj.body.storeCreditBalance).toBe("25.00");

    const stmt = await request(t.http())
      .get(`/customers/${customerId}/statement`)
      .set(bearer(ownerToken));
    expect(stmt.status).toBe(200);
    expect(stmt.body.customer.id).toBe(customerId);
    expect(stmt.body.balances.storeCreditBalance).toBe("25.00");
    expect(stmt.body.ledger.length).toBeGreaterThanOrEqual(1);
  });
});

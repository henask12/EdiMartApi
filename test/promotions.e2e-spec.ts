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

describe("promotions (phase 7)", () => {
  let t: TestApp;
  let ownerToken: string;
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
  });

  it("creates a coupon promo, evaluates it, and applies it at checkout", async () => {
    const promo = await request(t.http())
      .post("/promotions")
      .set(bearer(ownerToken))
      .send({
        name: "Ten percent",
        code: "SAVE10",
        type: "PERCENT_OFF",
        value: "10",
        target: "ALL",
        stackable: false,
        priority: 10,
      });
    expect(promo.status).toBe(201);
    expect(promo.body.code).toBe("SAVE10");

    const { product } = await createProduct(t.prisma, locationId, { stock: 5, price: 200 });

    const evaluated = await request(t.http())
      .post("/promotions/evaluate")
      .set(bearer(ownerToken))
      .send({
        lines: [{ productId: product.id, lineTotal: "200.00" }],
        subtotal: "200.00",
        couponCode: "save10",
      });
    expect(evaluated.status).toBe(201);
    expect(evaluated.body.totalDiscount).toBe("20.00");
    expect(evaluated.body.promotions).toHaveLength(1);

    const sold = await checkout(t, ownerToken, {
      lines: [{ productId: product.id, quantity: "1" }],
      couponCode: "SAVE10",
      payments: [{ method: "CASH", amount: "180.00" }],
    });
    expect(sold.status).toBe(201);
    expect(sold.body.sale.grandTotal).toBe("180.00");
    expect(sold.body.sale.discountTotal).toBe("20.00");

    const usage = await request(t.http())
      .get(`/promotions/${promo.body.id}/usage`)
      .set(bearer(ownerToken));
    expect(usage.status).toBe(200);
    expect(usage.body.total).toBe(1);
    expect(usage.body.items[0].discountAmount).toBe("20.00");

    const updated = await request(t.http())
      .get(`/promotions/${promo.body.id}`)
      .set(bearer(ownerToken));
    expect(updated.body.usageCount).toBe(1);
  });

  it("applies a min-spend fixed promo without a coupon", async () => {
    const promo = await request(t.http())
      .post("/promotions")
      .set(bearer(ownerToken))
      .send({
        name: "Spend 150 get 15 off",
        type: "MIN_SPEND_FIXED",
        value: "15",
        minSpend: "150",
        target: "ALL",
        priority: 5,
      });
    expect(promo.status).toBe(201);

    const { product } = await createProduct(t.prisma, locationId, { stock: 5, price: 200 });
    const sold = await checkout(t, ownerToken, {
      lines: [{ productId: product.id, quantity: "1" }],
      payments: [{ method: "CASH", amount: "185.00" }],
    });
    expect(sold.status).toBe(201);
    expect(sold.body.sale.grandTotal).toBe("185.00");
    expect(sold.body.sale.discountTotal).toBe("15.00");

    const got = await request(t.http())
      .get(`/promotions/${promo.body.id}`)
      .set(bearer(ownerToken));
    expect(got.body.usageCount).toBe(1);
  });
});

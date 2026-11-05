import { PermissionKey } from "@prisma/client";
import request from "supertest";
import { collectKeys, setRolePermissions, userWithPermissions } from "./access-helpers";
import { TestApp, bearer, checkout, close, createProduct, createTestApp, login, resetData, seedBasics } from "./helpers";

const K = PermissionKey;

/** Field names that reveal what something cost or what a sale earned. */
const COST_KEYS = ["costPrice", "averageCost", "unitCost", "unitCostAtSale", "netProfit", "stockValue"];

const RESTRICTED: PermissionKey[] = [
  K.PRODUCTS_VIEW, K.PRODUCTS_CREATE, K.PRODUCTS_EDIT, K.PRODUCTS_EXPORT, K.PRODUCTS_RESERVE,
  K.STOCK_VIEW, K.STOCK_RECEIVE, K.STOCK_HISTORY_VIEW, K.STOCK_ADJUST, K.STOCK_COUNT_APPROVE,
  K.SALES_CREATE, K.SALES_VIEW, K.SALES_VIEW_ALL, K.SALES_EXPORT, K.REPORTING_VIEW, K.RESERVATIONS_MANAGE,
];

describe("cost and profit are hidden unless REPORTS_VIEW_COST_PROFIT", () => {
  let t: TestApp;
  let ownerToken: string;
  let productId: string;
  let categoryId: string;
  let saleId: string;
  let movementId: string;
  let restricted: Awaited<ReturnType<typeof userWithPermissions>>;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => close(t));

  beforeEach(async () => {
    await resetData(t.prisma);
    const basics = await seedBasics(t.prisma);
    ownerToken = await login(t, "owner@test.local");
    const { product } = await createProduct(t.prisma, basics.location.id, { stock: 20, price: 100, cost: 60 });
    productId = product.id;
    categoryId = product.categoryId;
    const sale = await checkout(t, ownerToken, { lines: [{ productId, quantity: "2" }] });
    expect(sale.status).toBe(201);
    saleId = sale.body.sale.id;
    const adjust = await request(t.http())
      .post("/inventory/adjust")
      .set(bearer(ownerToken))
      .send({ productId, quantityDelta: "-1", notes: "broken" });
    expect(adjust.status).toBe(201);
    movementId = (await t.prisma.stockMovement.findFirstOrThrow({ where: { type: "ADJUSTMENT" } })).id;
    await request(t.http()).post("/reservations").set(bearer(ownerToken)).send({ productId, quantity: "1" });
    restricted = await userWithPermissions(t, RESTRICTED, "restricted");
  });

  const reads = () => [
    "/products",
    `/products/${productId}`,
    "/sales",
    `/sales/${saleId}`,
    "/sales/today-summary",
    "/reporting/dashboard",
    "/reporting/inventory-dashboard",
    "/reporting/sales?period=day",
    "/reporting/sales?period=week",
    "/reporting/sales?period=month",
    "/reporting/sales?period=year",
    "/reporting/sales-by-day",
    "/reporting/sales-by-product",
    "/reporting/stock-on-hand",
    "/reporting/valuation",
    "/reporting/dead-stock?days=90",
    "/stock/history",
    `/stock/history/${movementId}`,
    `/stock/batches?productId=${productId}`,
    `/inventory/movements?productId=${productId}`,
    "/inventory/expiry",
    "/reservations",
  ];

  it("no response, at any depth, contains a cost or profit field for a user without the permission", async () => {
    for (const path of reads()) {
      const res = await request(t.http()).get(path).set(bearer(restricted.token));
      expect(res.status).toBe(200);
      const leaked = COST_KEYS.filter((k) => collectKeys(res.body).has(k));
      expect({ path, leaked }).toEqual({ path, leaked: [] });
    }
  });

  it("the same screens DO show cost and profit to the owner (so the check above is meaningful)", async () => {
    const seen = new Set<string>();
    for (const path of reads()) {
      const res = await request(t.http()).get(path).set(bearer(ownerToken));
      expect(res.status).toBe(200);
      collectKeys(res.body).forEach((k) => seen.add(k));
    }
    for (const key of COST_KEYS) {
      expect(seen).toContain(key);
    }
  });

  it("write responses do not leak cost either", async () => {
    const checkoutRes = await checkout(t, restricted.token, { lines: [{ productId, quantity: "1" }] });
    expect(checkoutRes.status).toBe(201);

    const receive = await request(t.http())
      .post("/stock/receive")
      .set(bearer(restricted.token))
      .send({ productId, quantity: "5", unitCost: "70" });
    expect(receive.status).toBe(201);

    const adjust = await request(t.http())
      .post("/inventory/adjust")
      .set(bearer(restricted.token))
      .send({ productId, quantityDelta: "-1" });
    expect(adjust.status).toBe(201);

    const created = await request(t.http())
      .post("/products")
      .set(bearer(restricted.token))
      .send({ name: "Fresh product", categoryId, sellingPrice: "250", initialQuantity: "3" });
    expect(created.status).toBe(201);

    const updated = await request(t.http())
      .patch(`/products/${productId}`)
      .set(bearer(restricted.token))
      .send({ sellingPrice: "120" });
    expect(updated.status).toBe(200);

    for (const [name, body] of Object.entries({ checkoutRes: checkoutRes.body, receive: receive.body, adjust: adjust.body, created: created.body, updated: updated.body })) {
      const leaked = COST_KEYS.filter((k) => collectKeys(body).has(k));
      expect({ name, leaked }).toEqual({ name, leaked: [] });
    }
  });

  it("reservation responses (create, edit, cancel) do not carry the product's cost", async () => {
    const created = await request(t.http())
      .post("/reservations")
      .set(bearer(restricted.token))
      .send({ productId, quantity: "1", customerName: "Selam" });
    expect(created.status).toBe(201);
    const id = created.body.id as string;
    const edited = await request(t.http())
      .patch(`/reservations/${id}`)
      .set(bearer(restricted.token))
      .send({ quantity: "2" });
    expect(edited.status).toBe(200);
    const cancelled = await request(t.http()).post(`/reservations/${id}/cancel`).set(bearer(restricted.token));
    expect(cancelled.status).toBe(201);
    for (const body of [created.body, edited.body, cancelled.body]) {
      expect(COST_KEYS.filter((k) => collectKeys(body).has(k))).toEqual([]);
    }
  });

  it("exports leave out the cost and profit columns", async () => {
    const csv = async (path: string, token: string) =>
      (await request(t.http()).get(path).set(bearer(token))).text.split("\n")[0];
    expect(await csv("/products/export?format=csv", restricted.token)).not.toContain("Cost");
    expect(await csv("/products/export?format=csv", ownerToken)).toContain("Cost");
    expect(await csv("/sales/export?format=csv", restricted.token)).not.toContain("Net profit");
    expect(await csv("/sales/export?format=csv", ownerToken)).toContain("Net profit");
  });

  it("changing a product's cost price needs the same permission as seeing it", async () => {
    const edit = await request(t.http())
      .patch(`/products/${productId}`)
      .set(bearer(restricted.token))
      .send({ costPrice: "1" });
    expect(edit.status).toBe(403);
    const create = await request(t.http())
      .post("/products")
      .set(bearer(restricted.token))
      .send({ name: "Costed", categoryId, sellingPrice: "10", costPrice: "5" });
    expect(create.status).toBe(403);
    expect((await t.prisma.product.findUniqueOrThrow({ where: { id: productId } })).costPrice.toString()).toBe("60");
  });

  it("granting the permission shows the fields immediately, and lets the user change costs", async () => {
    await setRolePermissions(t, restricted.role.id, [...RESTRICTED, K.REPORTS_VIEW_COST_PROFIT]);
    const detail = await request(t.http()).get(`/products/${productId}`).set(bearer(restricted.token));
    expect(detail.body.costPrice).toBe("60.00");
    const dash = await request(t.http()).get("/reporting/dashboard").set(bearer(restricted.token));
    expect(dash.body.today.netProfit).toBeDefined();
    expect(dash.body.stockValue).toBeDefined();
    const edit = await request(t.http())
      .patch(`/products/${productId}`)
      .set(bearer(restricted.token))
      .send({ costPrice: "65" });
    expect(edit.status).toBe(200);
    expect(edit.body.costPrice).toBe("65.00");
  });

  it("receiving stock still accepts a unit cost (write-only) and uses it for the average cost", async () => {
    const before = await t.prisma.inventoryItem.findFirstOrThrow({ where: { productId } });
    const res = await request(t.http())
      .post("/stock/receive")
      .set(bearer(restricted.token))
      .send({ productId, quantity: "17", unitCost: "100" });
    expect(res.status).toBe(201);
    const after = await t.prisma.inventoryItem.findFirstOrThrow({ where: { productId } });
    expect(Number(after.averageCost)).toBeGreaterThan(Number(before.averageCost));
  });
});

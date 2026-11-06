import { PermissionKey } from "@prisma/client";
import request from "supertest";
import { collectKeys, userWithPermissions } from "./access-helpers";
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
import { businessDateString } from "../src/common/business-time";

const K = PermissionKey;
const COST_KEYS = ["costPrice", "averageCost", "unitCost", "unitCostAtSale", "netProfit", "stockValue", "costTotal", "cost"];

describe("Phase 8 reporting", () => {
  let t: TestApp;
  let ownerToken: string;
  let productId: string;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => close(t));

  beforeEach(async () => {
    await resetData(t.prisma);
    const basics = await seedBasics(t.prisma);
    ownerToken = await login(t, "owner@test.local");
    const { product } = await createProduct(t.prisma, basics.location.id, {
      stock: 20,
      price: 100,
      cost: 60,
    });
    productId = product.id;
  });

  it("rebuilds daily summaries after a sale and surfaces dashboard KPIs", async () => {
    const sale = await checkout(t, ownerToken, {
      lines: [{ productId, quantity: "2" }],
    });
    expect(sale.status).toBe(201);

    const today = businessDateString();
    const rebuild = await request(t.http())
      .post("/reporting/rebuild-summaries")
      .set(bearer(ownerToken))
      .send({ from: today, to: today });
    expect(rebuild.status).toBe(201);
    expect(rebuild.body.days).toBe(1);
    expect(rebuild.body.results[0].saleCount).toBe(1);
    expect(rebuild.body.results[0].grandTotal).toBe("200.00");

    const summary = await t.prisma.dailySalesSummary.findUnique({
      where: { businessDate: today },
    });
    expect(summary).toBeTruthy();
    expect(summary!.saleCount).toBe(1);
    expect(Number(summary!.grandTotal)).toBe(200);

    const productRows = await t.prisma.dailyProductSales.findMany({
      where: { businessDate: today },
    });
    expect(productRows).toHaveLength(1);
    expect(productRows[0].productId).toBe(productId);

    const dash = await request(t.http())
      .get("/reporting/dashboard?preset=today")
      .set(bearer(ownerToken));
    expect(dash.status).toBe(200);
    expect(dash.body.period.from).toBe(today);
    expect(dash.body.kpis.sales.value).toBe("200.00");
    expect(dash.body.kpis.transactions.value).toBe(1);
    expect(dash.body.kpis.profit).toBeDefined();
    expect(dash.body.today.grandTotal).toBeDefined();
    expect(Array.isArray(dash.body.needsAttention)).toBe(true);
    expect(Array.isArray(dash.body.salesByHour)).toBe(true);
    expect(dash.body.salesByHour).toHaveLength(24);
    expect(dash.body.topProducts.length).toBeGreaterThanOrEqual(1);
    expect(dash.body.topProducts[0].productId).toBe(productId);
  });

  it("omits cost fields on dashboard for users without REPORTS_VIEW_COST_PROFIT", async () => {
    await checkout(t, ownerToken, { lines: [{ productId, quantity: "1" }] });
    const today = businessDateString();
    await request(t.http())
      .post("/reporting/rebuild-summaries")
      .set(bearer(ownerToken))
      .send({ from: today, to: today });

    const restricted = await userWithPermissions(t, [K.REPORTING_VIEW], "reporter");
    const dash = await request(t.http())
      .get("/reporting/dashboard?preset=today")
      .set(bearer(restricted.token));
    expect(dash.status).toBe(200);
    expect(dash.body.kpis.sales).toBeDefined();
    expect(dash.body.kpis.profit).toBeUndefined();
    expect(dash.body.kpis.margin).toBeUndefined();
    expect(dash.body.stockValue).toBeUndefined();
    expect(dash.body.today.netProfit).toBeUndefined();
    const leaked = COST_KEYS.filter((k) => collectKeys(dash.body).has(k));
    expect(leaked).toEqual([]);
    if (dash.body.topProducts?.[0]) {
      expect(dash.body.topProducts[0].cost).toBeUndefined();
      expect(dash.body.topProducts[0].profit).toBeUndefined();
    }
  });

  it("exports sales-by-day as CSV", async () => {
    await checkout(t, ownerToken, { lines: [{ productId, quantity: "1" }] });
    const today = businessDateString();
    await request(t.http())
      .post("/reporting/rebuild-summaries")
      .set(bearer(ownerToken))
      .send({ from: today, to: today });

    const res = await request(t.http())
      .get(`/reporting/sales-by-day?from=${today}&to=${today}&format=csv`)
      .set(bearer(ownerToken));
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    expect(res.headers["content-disposition"]).toMatch(/sales-by-day/);
    expect(res.text).toContain("Date");
    expect(res.text).toContain(today);
  });

  it("needsAttention entries have kind, severity, title, count, href", async () => {
    const dash = await request(t.http())
      .get("/reporting/dashboard")
      .set(bearer(ownerToken));
    expect(dash.status).toBe(200);
    expect(Array.isArray(dash.body.needsAttention)).toBe(true);
    for (const item of dash.body.needsAttention) {
      expect(item).toEqual(
        expect.objectContaining({
          kind: expect.any(String),
          severity: expect.stringMatching(/info|warning|critical/),
          title: expect.any(String),
          count: expect.any(Number),
          href: expect.stringMatching(/^\//),
        }),
      );
    }
  });

  it("margin-alerts is empty without cost permission and populated for owner", async () => {
    const restricted = await userWithPermissions(t, [K.REPORTING_VIEW], "no-cost");
    const empty = await request(t.http())
      .get("/reporting/margin-alerts")
      .set(bearer(restricted.token));
    expect(empty.status).toBe(200);
    expect(empty.body.items).toEqual([]);

    const owner = await request(t.http())
      .get("/reporting/margin-alerts")
      .set(bearer(ownerToken));
    expect(owner.status).toBe(200);
    expect(Array.isArray(owner.body.items)).toBe(true);
  });
});

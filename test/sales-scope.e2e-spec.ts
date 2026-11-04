import { PermissionKey } from "@prisma/client";
import request from "supertest";
import { userWithPermissions } from "./access-helpers";
import { TestApp, bearer, checkout, close, createProduct, createTestApp, resetData, seedBasics } from "./helpers";

const K = PermissionKey;

describe("who sees which sales", () => {
  let t: TestApp;
  let productId: string;
  let alice: Awaited<ReturnType<typeof userWithPermissions>>;
  let bob: Awaited<ReturnType<typeof userWithPermissions>>;
  let aliceSale: string;
  let bobSale: string;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => close(t));

  beforeEach(async () => {
    await resetData(t.prisma);
    const basics = await seedBasics(t.prisma);
    ({ product: { id: productId } } = await createProduct(t.prisma, basics.location.id, { stock: 50 }));
    alice = await userWithPermissions(t, [K.SALES_CREATE, K.SALES_VIEW, K.SALES_EXPORT], "alice");
    bob = await userWithPermissions(t, [K.SALES_CREATE, K.SALES_VIEW, K.SALES_EXPORT], "bob");
    aliceSale = (await checkout(t, alice.token, { lines: [{ productId, quantity: "1" }] })).body.sale.id;
    bobSale = (await checkout(t, bob.token, { lines: [{ productId, quantity: "2" }] })).body.sale.id;
  });

  const ids = async (token: string) =>
    ((await request(t.http()).get("/sales").set(bearer(token))).body.items as { id: string }[]).map((s) => s.id);

  it("SALES_VIEW alone shows only the sales you recorded yourself", async () => {
    expect(await ids(alice.token)).toEqual([aliceSale]);
    expect(await ids(bob.token)).toEqual([bobSale]);
  });

  it("someone else's sale looks like it does not exist", async () => {
    expect((await request(t.http()).get(`/sales/${aliceSale}`).set(bearer(alice.token))).status).toBe(200);
    expect((await request(t.http()).get(`/sales/${bobSale}`).set(bearer(alice.token))).status).toBe(404);
  });

  it("SALES_VIEW_OWN is the same as SALES_VIEW without the old key", async () => {
    const carol = await userWithPermissions(t, [K.SALES_VIEW_OWN, K.SALES_CREATE], "carol");
    const own = (await checkout(t, carol.token, { lines: [{ productId, quantity: "1" }] })).body.sale.id;
    expect(await ids(carol.token)).toEqual([own]);
  });

  it("SALES_VIEW_ALL shows every sale", async () => {
    const boss = await userWithPermissions(t, [K.SALES_VIEW, K.SALES_VIEW_ALL], "boss");
    expect((await ids(boss.token)).sort()).toEqual([aliceSale, bobSale].sort());
    expect((await request(t.http()).get(`/sales/${bobSale}`).set(bearer(boss.token))).status).toBe(200);
  });

  it("the export follows the same rule", async () => {
    const aliceCsv = (await request(t.http()).get("/sales/export?format=csv").set(bearer(alice.token))).text;
    const numbers = (id: string) => t.prisma.sale.findUniqueOrThrow({ where: { id } }).then((s) => s.saleNumber);
    expect(aliceCsv).toContain(await numbers(aliceSale));
    expect(aliceCsv).not.toContain(await numbers(bobSale));
  });

  it("the sale you just recorded is always returned to you, even without any view permission", async () => {
    const cashierOnly = await userWithPermissions(t, [K.SALES_CREATE], "cashier-only");
    const res = await checkout(t, cashierOnly.token, { lines: [{ productId, quantity: "1" }] });
    expect(res.status).toBe(201);
    expect(res.body.sale.saleNumber).toMatch(/^SALE-/);
    expect((await request(t.http()).get("/sales").set(bearer(cashierOnly.token))).status).toBe(403);
  });
});

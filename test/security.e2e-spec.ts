import request from "supertest";
import * as bcrypt from "bcryptjs";
import {
  PASSWORD,
  TestApp,
  bearer,
  close,
  createProduct,
  createTestApp,
  login,
  resetData,
  seedBasics,
} from "./helpers";

describe("authentication, sessions and hardening", () => {
  let t: TestApp;
  let basics: Awaited<ReturnType<typeof seedBasics>>;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => close(t));
  beforeEach(async () => {
    await resetData(t.prisma);
    basics = await seedBasics(t.prisma);
  });

  it("reports the session length so the web cookie matches the token (default 8 h)", async () => {
    const res = await request(t.http()).post("/auth/login").send({ email: "owner@test.local", password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.expiresInSeconds).toBe(8 * 3600);
    const payload = JSON.parse(Buffer.from(res.body.accessToken.split(".")[1], "base64url").toString());
    expect(payload.exp - payload.iat).toBe(8 * 3600);
  });

  it("stops accepting the token of a user who was deactivated", async () => {
    const token = await login(t, "cashier@test.local");
    expect((await request(t.http()).get("/auth/me").set(bearer(token))).status).toBe(200);
    await t.prisma.user.update({ where: { id: basics.users.CASHIER.id }, data: { isActive: false } });
    expect((await request(t.http()).get("/auth/me").set(bearer(token))).status).toBe(401);
  });

  it("locks a user who must change their password to the change-password screen", async () => {
    await t.prisma.user.update({ where: { id: basics.users.CASHIER.id }, data: { mustChangePassword: true } });
    const token = await login(t, "cashier@test.local");

    const me = await request(t.http()).get("/auth/me").set(bearer(token));
    expect(me.status).toBe(200);
    expect(me.body.mustChangePassword).toBe(true);

    const blocked = await request(t.http()).get("/products").set(bearer(token));
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe("PASSWORD_CHANGE_REQUIRED");

    const same = await request(t.http())
      .post("/auth/change-password")
      .set(bearer(token))
      .send({ currentPassword: PASSWORD, newPassword: PASSWORD });
    expect(same.status).toBe(400);

    const changed = await request(t.http())
      .post("/auth/change-password")
      .set(bearer(token))
      .send({ currentPassword: PASSWORD, newPassword: "A-Brand-New-Pass-9" });
    expect(changed.status).toBe(201);

    expect((await request(t.http()).get("/products").set(bearer(token))).status).toBe(200);
  });

  it("makes admin-created and admin-reset accounts change their password", async () => {
    const ownerToken = await login(t, "owner@test.local");
    const created = await request(t.http())
      .post("/users")
      .set(bearer(ownerToken))
      .send({ email: "new@test.local", password: "Temp-Pass-12345", role: "CASHIER" });
    expect(created.status).toBe(201);
    expect((await t.prisma.user.findUniqueOrThrow({ where: { email: "new@test.local" } })).mustChangePassword).toBe(true);

    await t.prisma.user.update({ where: { id: basics.users.CASHIER.id }, data: { mustChangePassword: false } });
    await request(t.http())
      .post(`/users/${basics.users.CASHIER.id}/reset-password`)
      .set(bearer(ownerToken))
      .send({ password: "Reset-Pass-12345" })
      .expect(201);
    expect((await t.prisma.user.findUniqueOrThrow({ where: { id: basics.users.CASHIER.id } })).mustChangePassword).toBe(true);
  });

  it("security headers are set and the health check touches the database", async () => {
    const res = await request(t.http()).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, service: "edimart-api", db: "up" });
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });

  it("only allows the configured web origin in CORS", async () => {
    const allowed = await request(t.http()).get("/health").set("Origin", "http://localhost:3000");
    expect(allowed.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
    const denied = await request(t.http()).get("/health").set("Origin", "https://evil.example");
    expect(denied.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("the setup endpoints do not exist unless SETUP_ENABLED is on", async () => {
    expect((await request(t.http()).get("/setup/status")).status).toBe(404);
    expect((await request(t.http()).post("/setup/seed").set("X-Setup-Key", "x")).status).toBe(404);
  });

  it("rate-limits login attempts per account", async () => {
    const previous = process.env.LOGIN_RATE_LIMIT;
    process.env.LOGIN_RATE_LIMIT = "3";
    const limited = await createTestApp();
    try {
      const attempt = () =>
        request(limited.http()).post("/auth/login").send({ email: "owner@test.local", password: "wrong-password" });
      expect((await attempt()).status).toBe(401);
      expect((await attempt()).status).toBe(401);
      expect((await attempt()).status).toBe(401);
      expect((await attempt()).status).toBe(429);
      // A different account is not affected.
      const other = await request(limited.http())
        .post("/auth/login")
        .send({ email: "cashier@test.local", password: PASSWORD });
      expect(other.status).toBe(200);
    } finally {
      process.env.LOGIN_RATE_LIMIT = previous;
      await close(limited);
    }
  });
});

describe("permissions on read endpoints", () => {
  let t: TestApp;
  let basics: Awaited<ReturnType<typeof seedBasics>>;
  let noPermsToken: string;
  let cashierToken: string;
  let ownerToken: string;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => close(t));
  beforeEach(async () => {
    await resetData(t.prisma);
    basics = await seedBasics(t.prisma);
    // A custom role with no permissions at all.
    const empty = await t.prisma.role.create({ data: { name: "NOBODY" } });
    await t.prisma.user.create({
      data: {
        email: "nobody@test.local",
        passwordHash: await bcrypt.hash(PASSWORD, 4),
        roleId: empty.id,
      },
    });
    noPermsToken = await login(t, "nobody@test.local");
    cashierToken = await login(t, "cashier@test.local");
    ownerToken = await login(t, "owner@test.local");
  });

  const protectedReads = [
    "/products",
    "/products/some-id",
    "/categories",
    "/categories/some-id",
    "/product-types",
    "/product-types/some-id",
    "/stock/history",
    "/stock/history/some-id",
    "/stock/batches?productId=x",
    "/inventory/movements",
    "/reservations",
  ];

  it.each(protectedReads)("%s is refused to a user without the permission", async (path) => {
    const res = await request(t.http()).get(path).set(bearer(noPermsToken));
    expect(res.status).toBe(403);
  });

  it("the default cashier can browse products but not stock history", async () => {
    expect((await request(t.http()).get("/products").set(bearer(cashierToken))).status).toBe(200);
    expect((await request(t.http()).get("/categories").set(bearer(cashierToken))).status).toBe(200);
    expect((await request(t.http()).get("/stock/history").set(bearer(cashierToken))).status).toBe(403);
    expect((await request(t.http()).get("/inventory/movements").set(bearer(cashierToken))).status).toBe(403);
  });

  it("the owner can read everything", async () => {
    for (const path of ["/products", "/categories", "/stock/history", "/inventory/movements", "/reservations"]) {
      expect((await request(t.http()).get(path).set(bearer(ownerToken))).status).toBe(200);
    }
  });

  it("deactivating a product needs PRODUCTS_DEACTIVATE; editing needs PRODUCTS_EDIT", async () => {
    const { product } = await createProduct(t.prisma, basics.location.id, { stock: 1 });
    const deactivate = await request(t.http())
      .patch(`/products/${product.id}`)
      .set(bearer(cashierToken))
      .send({ isActive: false });
    expect(deactivate.status).toBe(403);

    const edit = await request(t.http())
      .patch(`/products/${product.id}`)
      .set(bearer(cashierToken))
      .send({ restockAt: 3 });
    expect(edit.status).toBe(200);

    const byOwner = await request(t.http())
      .patch(`/products/${product.id}`)
      .set(bearer(ownerToken))
      .send({ isActive: false });
    expect(byOwner.status).toBe(200);
  });

  it("the duplicate /inventory/receive endpoint is gone and /stock/receive accepts an expiry date", async () => {
    const { product } = await createProduct(t.prisma, basics.location.id, { stock: 0 });
    const staffToken = await login(t, "store_staff@test.local");
    const gone = await request(t.http())
      .post("/inventory/receive")
      .set(bearer(staffToken))
      .send({ productId: product.id, quantity: "5", unitCost: "10" });
    expect(gone.status).toBe(404);

    const ok = await request(t.http())
      .post("/stock/receive")
      .set(bearer(staffToken))
      .send({ productId: product.id, quantity: "5", unitCost: "10", expiryDate: "2030-01-31" });
    expect(ok.status).toBe(201);
    const batch = await t.prisma.stockBatch.findFirstOrThrow({ where: { productId: product.id } });
    expect(batch.expiryDate?.toISOString().slice(0, 10)).toBe("2030-01-31");
  });

  it("parallel receipts of the same product do not lose each other", async () => {
    const { product } = await createProduct(t.prisma, basics.location.id, { stock: 0 });
    const staffToken = await login(t, "store_staff@test.local");
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        request(t.http())
          .post("/stock/receive")
          .set(bearer(staffToken))
          .send({ productId: product.id, quantity: "10", unitCost: "5" }),
      ),
    );
    expect(results.every((r) => r.status === 201)).toBe(true);
    const inv = await t.prisma.inventoryItem.findFirstOrThrow({ where: { productId: product.id } });
    expect(inv.quantityOnHand.toString()).toBe("60");
  });
});

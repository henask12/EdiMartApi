import request from "supertest";
import { TestApp, bearer, close, createTestApp, login, PASSWORD, resetData, seedBasics } from "./helpers";

describe("auth sessions (Phase 9)", () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => close(t));
  beforeEach(async () => {
    await resetData(t.prisma);
    await seedBasics(t.prisma);
  });

  it("login creates an AuthSession with jti and /auth/sessions lists it as current", async () => {
    const token = await login(t, "owner@test.local");
    const sessions = await request(t.http()).get("/auth/sessions").set(bearer(token));
    expect(sessions.status).toBe(200);
    expect(sessions.body.length).toBeGreaterThanOrEqual(1);
    expect(sessions.body.some((s: { current: boolean }) => s.current)).toBe(true);

    const rows = await t.prisma.authSession.count({ where: { revokedAt: null } });
    expect(rows).toBeGreaterThanOrEqual(1);
  });

  it("revoke-others invalidates other tokens but keeps the current one", async () => {
    const tokenA = await login(t, "cashier@test.local");
    const tokenB = await login(t, "cashier@test.local");

    expect((await request(t.http()).get("/auth/me").set(bearer(tokenA))).status).toBe(200);
    expect((await request(t.http()).get("/auth/me").set(bearer(tokenB))).status).toBe(200);

    const revoke = await request(t.http())
      .post("/auth/sessions/revoke-others")
      .set(bearer(tokenB));
    expect(revoke.status).toBe(201);
    expect(revoke.body.revoked).toBeGreaterThanOrEqual(1);

    expect((await request(t.http()).get("/auth/me").set(bearer(tokenA))).status).toBe(401);
    expect((await request(t.http()).get("/auth/me").set(bearer(tokenB))).status).toBe(200);
  });

  it("logout revokes the current session", async () => {
    const token = await login(t, "owner@test.local");
    const out = await request(t.http()).post("/auth/logout").set(bearer(token));
    expect(out.status).toBe(201);
    expect((await request(t.http()).get("/auth/me").set(bearer(token))).status).toBe(401);
  });

  it("change-password enforces the password policy", async () => {
    const token = await login(t, "owner@test.local");
    const bad = await request(t.http())
      .post("/auth/change-password")
      .set(bearer(token))
      .send({ currentPassword: PASSWORD, newPassword: "short" });
    expect(bad.status).toBe(400);
  });
});

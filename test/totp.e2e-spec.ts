import request from "supertest";
import { generateTotpCode } from "../src/common/totp";
import { TestApp, bearer, close, createTestApp, login, PASSWORD, resetData, seedBasics } from "./helpers";

describe("TOTP 2FA (Phase 9)", () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => close(t));
  beforeEach(async () => {
    await resetData(t.prisma);
    await seedBasics(t.prisma);
  });

  it("setup → enable → login requires totpCode", async () => {
    const token = await login(t, "owner@test.local");
    const setup = await request(t.http()).post("/auth/totp/setup").set(bearer(token));
    expect(setup.status).toBe(201);
    expect(setup.body.secret).toBeTruthy();
    expect(setup.body.otpauthUrl).toContain("otpauth://");

    const code = generateTotpCode(setup.body.secret as string);
    const enable = await request(t.http())
      .post("/auth/totp/enable")
      .set(bearer(token))
      .send({ code });
    expect(enable.status).toBe(201);
    expect(enable.body.totpEnabled).toBe(true);

    const noCode = await request(t.http())
      .post("/auth/login")
      .send({ email: "owner@test.local", password: PASSWORD });
    expect(noCode.status).toBe(401);
    expect(noCode.body.code).toBe("TOTP_REQUIRED");

    const totp = generateTotpCode(setup.body.secret as string);
    const withCode = await request(t.http())
      .post("/auth/login")
      .send({ email: "owner@test.local", password: PASSWORD, totpCode: totp });
    expect(withCode.status).toBe(200);
    expect(withCode.body.accessToken).toBeTruthy();
  });
});

import { PermissionKey } from "@prisma/client";
import request from "supertest";
import { userWithPermissions } from "./access-helpers";
import {
  PASSWORD,
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

const K = PermissionKey;

describe("Phase 5 shifts and cash", () => {
  let t: TestApp;
  let locationId: string;
  let ownerToken: string;
  let ownerId: string;

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
  });

  const enableRequireShift = () =>
    t.prisma.storeSetting.upsert({
      where: { key: "shifts.requireOpenShift" },
      update: { value: "true" },
      create: { key: "shifts.requireOpenShift", value: "true" },
    });

  const setThreshold = (value: string) =>
    t.prisma.storeSetting.upsert({
      where: { key: "shifts.varianceApprovalThreshold" },
      update: { value },
      create: { key: "shifts.varianceApprovalThreshold", value },
    });

  const openShift = (token: string, denominations: Record<string, number> = { "100": 5 }) =>
    request(t.http()).post("/shifts/open").set(bearer(token)).send({ denominations });

  const setPin = (token: string, pin: string) =>
    request(t.http()).put("/auth/pin").set(bearer(token)).send({ currentPassword: PASSWORD, pin });

  const approve = (token: string, body: Record<string, unknown>) =>
    request(t.http()).post("/approvals").set(bearer(token)).send(body);

  it("lists the default REGISTER-1 till", async () => {
    const res = await request(t.http()).get("/registers").set(bearer(ownerToken));
    expect(res.status).toBe(200);
    expect(res.body.some((r: { code: string }) => r.code === "REGISTER-1")).toBe(true);
  });

  it("blocks checkout when requireOpenShift is on and no shift is open", async () => {
    await enableRequireShift();
    const { product } = await createProduct(t.prisma, locationId, { stock: 5, price: 50 });
    const cashier = await userWithPermissions(t, [K.SALES_CREATE, K.SHIFT_MANAGE], "cashier");
    const res = await checkout(t, cashier.token, {
      lines: [{ productId: product.id, quantity: "1" }],
      paymentMethod: "CASH",
    });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("SHIFT_REQUIRED");
  });

  it("open → sell with shiftId → close blind count", async () => {
    await enableRequireShift();
    const { product } = await createProduct(t.prisma, locationId, { stock: 10, price: 100 });
    const cashier = await userWithPermissions(t, [K.SALES_CREATE, K.SHIFT_MANAGE], "cashier");

    const opened = await openShift(cashier.token, { "100": 2 }); // opening float 200
    expect(opened.status).toBe(201);
    expect(opened.body.openingFloat).toBe("200");
    expect(opened.body.status).toBe("OPEN");
    const shiftId = opened.body.id as string;

    const sold = await checkout(t, cashier.token, {
      lines: [{ productId: product.id, quantity: "1" }],
      paymentMethod: "CASH",
    });
    expect(sold.status).toBe(201);
    expect(sold.body.sale.shiftId).toBe(shiftId);

    // Blind close: count opening 200 + sale 100 = 300 expected; count exactly.
    const closed = await request(t.http())
      .post(`/shifts/${shiftId}/close`)
      .set(bearer(cashier.token))
      .send({ denominations: { "100": 3 } });
    expect(closed.status).toBe(201);
    expect(closed.body.status).toBe("CLOSED");
    expect(closed.body.countedCash).toBe("300");
    expect(closed.body.expectedCash).toBe("300");
    expect(closed.body.variance).toBe("0");

    const z = await request(t.http())
      .get(`/shifts/${shiftId}/z-report`)
      .set(bearer(cashier.token));
    expect(z.status).toBe(200);
    expect(z.body.kind).toBe("Z");
    expect(z.body.variance).toBe("0");
  });

  it("variance over limit requires SHIFT_VARIANCE_OVER_LIMIT approval", async () => {
    await enableRequireShift();
    await setThreshold("50");
    const { product } = await createProduct(t.prisma, locationId, { stock: 5, price: 100 });
    const cashier = await userWithPermissions(t, [K.SALES_CREATE, K.SHIFT_MANAGE], "cashier");
    const manager = await userWithPermissions(t, [K.SHIFT_VIEW_ALL], "mgr");
    await setPin(manager.token, "4821");

    const opened = await openShift(cashier.token, { "100": 1 }); // float 100
    expect(opened.status).toBe(201);
    const shiftId = opened.body.id as string;

    expect(
      (
        await checkout(t, cashier.token, {
          lines: [{ productId: product.id, quantity: "1" }],
          paymentMethod: "CASH",
        })
      ).status,
    ).toBe(201);

    // Expected = 100 + 100 = 200; count 50 → variance -150 over threshold 50
    const denied = await request(t.http())
      .post(`/shifts/${shiftId}/close`)
      .set(bearer(cashier.token))
      .send({ denominations: { "50": 1 } });
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe("APPROVAL_REQUIRED");
    expect(denied.body.action).toBe("SHIFT_VARIANCE_OVER_LIMIT");
    // Blind: expected must not be revealed in the denial payload
    expect(denied.body.expectedCash).toBeUndefined();

    const token = (
      await approve(cashier.token, {
        managerId: manager.user.id,
        pin: "4821",
        action: "SHIFT_VARIANCE_OVER_LIMIT",
      })
    ).body.token as string;

    const closed = await request(t.http())
      .post(`/shifts/${shiftId}/close`)
      .set(bearer(cashier.token))
      .set("x-approval-token", token)
      .send({ denominations: { "50": 1 } });
    expect(closed.status).toBe(201);
    expect(closed.body.variance).toBe("-150");
    expect(closed.body.varianceApprovedByUserId).toBe(manager.user.id);
  });

  it("cash-in / cash-out and no-sale log without drawer kick", async () => {
    const cashier = await userWithPermissions(
      t,
      [K.SHIFT_MANAGE, K.CASH_DRAWER_OPEN],
      "drawer",
    );
    const opened = await openShift(cashier.token, { "100": 1 });
    const shiftId = opened.body.id as string;

    const cin = await request(t.http())
      .post(`/shifts/${shiftId}/cash-in`)
      .set(bearer(cashier.token))
      .send({ amount: "50", reason: "Change bag" });
    expect(cin.status).toBe(201);
    expect(cin.body.type).toBe("CASH_IN");

    const cout = await request(t.http())
      .post(`/shifts/${shiftId}/cash-out`)
      .set(bearer(cashier.token))
      .send({ amount: "20", reason: "Supplies" });
    expect(cout.status).toBe(201);

    const nosale = await request(t.http())
      .post(`/shifts/${shiftId}/no-sale`)
      .set(bearer(cashier.token))
      .send({ reason: "Customer change check" });
    expect(nosale.status).toBe(201);
    expect(nosale.body.type).toBe("NO_SALE_OPEN");
    expect(nosale.body.amount).toBe("0");

    const x = await request(t.http())
      .get(`/shifts/${shiftId}/x-report`)
      .set(bearer(cashier.token));
    expect(x.status).toBe(200);
    expect(x.body.kind).toBe("X");
    expect(x.body.cashMovements.cashIn).toBe("50");
    expect(x.body.cashMovements.cashOut).toBe("20");
    expect(x.body.cashMovements.noSaleOpens).toBe(1);
  });

  it("z-report is forbidden while the shift is still open", async () => {
    const cashier = await userWithPermissions(t, [K.SHIFT_MANAGE], "c2");
    const opened = await openShift(cashier.token, { "100": 1 });
    const z = await request(t.http())
      .get(`/shifts/${opened.body.id}/z-report`)
      .set(bearer(cashier.token));
    expect(z.status).toBe(403);
    expect(z.body.code).toBe("SHIFT_STILL_OPEN");
  });

  it("one open shift per register", async () => {
    const a = await userWithPermissions(t, [K.SHIFT_MANAGE], "a");
    const b = await userWithPermissions(t, [K.SHIFT_MANAGE], "b");
    expect((await openShift(a.token)).status).toBe(201);
    const second = await openShift(b.token);
    expect(second.status).toBe(409);
    expect(second.body.code).toBe("SHIFT_ALREADY_OPEN");
  });

  void ownerId;
});

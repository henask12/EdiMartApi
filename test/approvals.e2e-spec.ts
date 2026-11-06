import { PermissionKey } from "@prisma/client";
import request from "supertest";
import { userWithPermissions } from "./access-helpers";
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

const K = PermissionKey;

describe("manager PIN approvals", () => {
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

  const setPin = (token: string, pin: string, password = PASSWORD) =>
    request(t.http()).put("/auth/pin").set(bearer(token)).send({ currentPassword: password, pin });

  const approve = (token: string, body: Record<string, unknown>) =>
    request(t.http()).post("/approvals").set(bearer(token)).send(body);

  describe("setting a PIN", () => {
    it("needs the current password, 4-6 digits, and rejects easy ones", async () => {
      expect((await setPin(ownerToken, "4821", "wrong-password")).status).toBe(400);
      for (const bad of ["123", "1234567", "12ab", "0000", "1111", "1234", "4321", "6789"]) {
        expect((await setPin(ownerToken, bad)).status).toBe(400);
      }
      const ok = await setPin(ownerToken, "4821");
      expect(ok.status).toBe(200);
      expect(ok.body.hasPin).toBe(true);
    });

    it("stores only a hash and reports hasPin on /auth/me", async () => {
      expect((await request(t.http()).get("/auth/me").set(bearer(ownerToken))).body.hasPin).toBe(false);
      await setPin(ownerToken, "4821");
      const stored = await t.prisma.user.findUniqueOrThrow({ where: { id: ownerId } });
      expect(stored.pinHash).toMatch(/^\$2[aby]\$/);
      expect(stored.pinHash).not.toContain("4821");
      expect((await request(t.http()).get("/auth/me").set(bearer(ownerToken))).body.hasPin).toBe(true);
    });

    it("can be removed", async () => {
      await setPin(ownerToken, "4821");
      const res = await request(t.http())
        .put("/auth/pin")
        .set(bearer(ownerToken))
        .send({ currentPassword: PASSWORD, remove: true });
      expect(res.status).toBe(200);
      expect(res.body.hasPin).toBe(false);
      expect((await t.prisma.user.findUniqueOrThrow({ where: { id: ownerId } })).pinHash).toBeNull();
    });

    it("needs either a pin or remove:true", async () => {
      const res = await request(t.http()).put("/auth/pin").set(bearer(ownerToken)).send({ currentPassword: PASSWORD });
      expect(res.status).toBe(400);
    });
  });

  describe("who can approve", () => {
    it("lists active people with a PIN who hold the permission, never the requester", async () => {
      const cashier = await userWithPermissions(t, [K.SALES_CREATE], "cashier");
      const withPerm = await userWithPermissions(t, [K.SALES_VOID], "voider");
      const withoutPin = await userWithPermissions(t, [K.SALES_VOID], "nopin");
      const wrongPerm = await userWithPermissions(t, [K.STOCK_ADJUST], "other");
      const inactive = await userWithPermissions(t, [K.SALES_VOID], "inactive");
      for (const u of [withPerm, wrongPerm, inactive]) await setPin(u.token, "4821");
      await setPin(ownerToken, "5937");
      await t.prisma.user.update({ where: { id: inactive.user.id }, data: { isActive: false } });
      void withoutPin;

      const res = await request(t.http())
        .get("/approvals/managers?action=SALE_VOID")
        .set(bearer(cashier.token));
      expect(res.status).toBe(200);
      const names = (res.body as { name: string }[]).map((m) => m.name).sort();
      expect(names).toEqual([withPerm.user.displayName, "OWNER"].sort());

      // the requester never appears, even when they could approve
      const own = await request(t.http()).get("/approvals/managers?action=SALE_VOID").set(bearer(ownerToken));
      expect((own.body as { id: string }[]).map((m) => m.id)).not.toContain(ownerId);
    });

    it("rejects an unknown action", async () => {
      const res = await request(t.http()).get("/approvals/managers?action=NUKE").set(bearer(ownerToken));
      expect(res.status).toBe(400);
    });
  });

  describe("approving", () => {
    let cashier: Awaited<ReturnType<typeof userWithPermissions>>;
    beforeEach(async () => {
      cashier = await userWithPermissions(t, [K.SALES_CREATE], "cashier");
      await setPin(ownerToken, "4821");
    });

    it("returns a token for the right manager, PIN and action, and records it", async () => {
      const res = await approve(cashier.token, { managerId: ownerId, pin: "4821", action: "SALE_VOID" });
      expect(res.status).toBe(201);
      expect(res.body.token.length).toBeGreaterThan(20);
      expect(res.body.expiresInSeconds).toBe(120);
      expect(res.body.approver.id).toBe(ownerId);
      const audit = await t.prisma.auditLog.findFirstOrThrow({ where: { action: "APPROVAL_GRANTED" } });
      expect(audit.userId).toBe(cashier.user.id);
      expect((audit.metadata as { approvedByUserId: string }).approvedByUserId).toBe(ownerId);
      // only the hash of the token is stored
      const row = await t.prisma.approval.findFirstOrThrow();
      expect(row.tokenHash).not.toBe(res.body.token);
    });

    it("refuses a wrong PIN, an unknown manager, a manager without the permission, and self-approval", async () => {
      expect((await approve(cashier.token, { managerId: ownerId, pin: "9999", action: "SALE_VOID" })).status).toBe(401);
      expect((await approve(cashier.token, { managerId: "nobody", pin: "4821", action: "SALE_VOID" })).status).toBe(401);

      const noPerm = await userWithPermissions(t, [K.STOCK_ADJUST], "noperm");
      await setPin(noPerm.token, "5937");
      expect((await approve(cashier.token, { managerId: noPerm.user.id, pin: "5937", action: "SALE_VOID" })).status).toBe(401);

      // a manager cannot approve their own request
      expect((await approve(ownerToken, { managerId: ownerId, pin: "4821", action: "SALE_VOID" })).status).toBe(401);
    });

    it("validates the request", async () => {
      expect((await approve(cashier.token, { managerId: ownerId, pin: "12", action: "SALE_VOID" })).status).toBe(400);
      expect((await approve(cashier.token, { managerId: ownerId, pin: "4821", action: "NUKE" })).status).toBe(400);
    });

    it("locks the PIN after five wrong tries, even for the right PIN, until the lock runs out", async () => {
      for (let i = 0; i < 5; i += 1) {
        expect((await approve(cashier.token, { managerId: ownerId, pin: "0001", action: "SALE_VOID" })).status).toBe(401);
      }
      const locked = await approve(cashier.token, { managerId: ownerId, pin: "4821", action: "SALE_VOID" });
      expect(locked.status).toBe(429);
      const state = await t.prisma.user.findUniqueOrThrow({ where: { id: ownerId } });
      expect(state.pinLockedUntil!.getTime()).toBeGreaterThan(Date.now() + 14 * 60_000);

      await t.prisma.user.update({ where: { id: ownerId }, data: { pinLockedUntil: new Date(Date.now() - 1000) } });
      const open = await approve(cashier.token, { managerId: ownerId, pin: "4821", action: "SALE_VOID" });
      expect(open.status).toBe(201);
      expect((await t.prisma.user.findUniqueOrThrow({ where: { id: ownerId } })).pinFailedAttempts).toBe(0);
    });

    it("parallel guessing cannot get more than five tries", async () => {
      const results = await Promise.all(
        Array.from({ length: 25 }, (_, i) =>
          approve(cashier.token, { managerId: ownerId, pin: String(1000 + i).padStart(4, "1"), action: "SALE_VOID" }),
        ),
      );
      const statuses = results.map((r) => r.status);
      expect(statuses.filter((s) => s === 401).length).toBeLessThanOrEqual(5);
      expect(statuses.filter((s) => s === 429).length).toBeGreaterThanOrEqual(20);
    });

    it("a successful approval clears earlier wrong tries", async () => {
      await approve(cashier.token, { managerId: ownerId, pin: "0001", action: "SALE_VOID" });
      await approve(cashier.token, { managerId: ownerId, pin: "0002", action: "SALE_VOID" });
      expect((await approve(cashier.token, { managerId: ownerId, pin: "4821", action: "SALE_VOID" })).status).toBe(201);
      expect((await t.prisma.user.findUniqueOrThrow({ where: { id: ownerId } })).pinFailedAttempts).toBe(0);
    });
  });

  describe("large stock corrections", () => {
    let staff: Awaited<ReturnType<typeof userWithPermissions>>;
    let productId: string;

    beforeEach(async () => {
      staff = await userWithPermissions(t, [K.STOCK_ADJUST, K.STOCK_VIEW], "adjuster");
      // 100 Birr each: a correction of 60 units is worth 6,000 (over the default 5,000 limit)
      ({ product: { id: productId } } = await createProduct(t.prisma, locationId, { stock: 100, cost: 100 }));
      await setPin(ownerToken, "4821");
    });

    const adjust = (token: string, delta: string, approval?: string) => {
      const req = request(t.http()).post("/inventory/adjust").set(bearer(token));
      if (approval) req.set("X-Approval-Token", approval);
      return req.send({ productId, quantityDelta: delta, notes: "count" });
    };
    const getToken = async () =>
      (await approve(staff.token, { managerId: ownerId, pin: "4821", action: "STOCK_ADJUST_OVER_LIMIT" })).body.token as string;
    const onHand = async () =>
      (await t.prisma.inventoryItem.findFirstOrThrow({ where: { productId } })).quantityOnHand.toString();

    it("small corrections go straight through", async () => {
      expect((await adjust(staff.token, "-10")).status).toBe(201); // 1,000 Birr
      expect(await onHand()).toBe("90");
    });

    it("a correction over the limit is refused with a clear 'approval required' answer", async () => {
      const res = await adjust(staff.token, "-60");
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("APPROVAL_REQUIRED");
      expect(res.body.action).toBe("STOCK_ADJUST_OVER_LIMIT");
      expect(res.body.value).toBe("6000.00");
      expect(res.body.threshold).toBe("5000.00");
      expect(await onHand()).toBe("100");
    });

    it("the same correction goes through with a manager's token, and the manager is recorded", async () => {
      const token = await getToken();
      const res = await adjust(staff.token, "-60", token);
      expect(res.status).toBe(201);
      expect(await onHand()).toBe("40");
      const movement = await t.prisma.stockMovement.findFirstOrThrow({ where: { type: "ADJUSTMENT" } });
      expect((movement.metadata as { approvedByUserId: string }).approvedByUserId).toBe(ownerId);
      const audit = await t.prisma.auditLog.findFirstOrThrow({ where: { action: "ADJUST" } });
      expect(audit.userId).toBe(staff.user.id);
      expect((audit.metadata as { approvedByUserId: string }).approvedByUserId).toBe(ownerId);
    });

    it("a token works once only", async () => {
      const token = await getToken();
      expect((await adjust(staff.token, "-60", token)).status).toBe(201);
      // plenty of stock again, so the second correction is large and valid on its own
      await t.prisma.inventoryItem.updateMany({ where: { productId }, data: { quantityOnHand: 300 } });
      const reused = await adjust(staff.token, "-60", token);
      expect(reused.status).toBe(403);
      expect(reused.body.code).toBe("APPROVAL_INVALID");
      expect(await onHand()).toBe("300");
    });

    it("rejects a token that expired, belongs to another action, or another person", async () => {
      const token = await getToken();
      await t.prisma.approval.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
      expect((await adjust(staff.token, "-60", token)).body.code).toBe("APPROVAL_INVALID");

      await t.prisma.approval.deleteMany();
      const voidToken = (await approve(staff.token, { managerId: ownerId, pin: "4821", action: "SALE_VOID" })).body.token;
      expect((await adjust(staff.token, "-60", voidToken)).body.code).toBe("APPROVAL_INVALID");

      const other = await userWithPermissions(t, [K.STOCK_ADJUST], "other-adjuster");
      const theirs = (await approve(other.token, { managerId: ownerId, pin: "4821", action: "STOCK_ADJUST_OVER_LIMIT" })).body.token;
      expect((await adjust(staff.token, "-60", theirs)).body.code).toBe("APPROVAL_INVALID");
      expect(await onHand()).toBe("100");
    });

    it("a failed correction does not use up the approval", async () => {
      const token = await getToken();
      const tooMuch = await adjust(staff.token, "-150", token); // would go negative
      expect(tooMuch.status).toBe(400);
      expect((await t.prisma.approval.findFirstOrThrow()).consumedAt).toBeNull();
      expect((await adjust(staff.token, "-60", token)).status).toBe(201);
    });

    it("a person who can approve (STOCK_COUNT_APPROVE) or the owner needs no token", async () => {
      const lead = await userWithPermissions(t, [K.STOCK_ADJUST, K.STOCK_COUNT_APPROVE], "lead");
      expect((await adjust(lead.token, "-60")).status).toBe(201);
      expect((await adjust(ownerToken, "-10")).status).toBe(201);
    });

    it("positive corrections count too (a big surplus also needs approval)", async () => {
      const res = await adjust(staff.token, "60");
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("APPROVAL_REQUIRED");
    });

    it("uses the product's cost when no average cost exists yet", async () => {
      await t.prisma.inventoryItem.updateMany({ where: { productId }, data: { averageCost: 0 } });
      expect((await adjust(staff.token, "-60")).status).toBe(403);
    });
  });

  describe("the approval limit setting", () => {
    it("is owner/SETTINGS_MANAGE only, validated, and changes what needs approval", async () => {
      const staff = await userWithPermissions(t, [K.STOCK_ADJUST], "adjuster");
      const { product } = await createProduct(t.prisma, locationId, { stock: 100, cost: 100 });
      const adjust = (delta: string) =>
        request(t.http())
          .post("/inventory/adjust")
          .set(bearer(staff.token))
          .send({ productId: product.id, quantityDelta: delta });

      expect((await request(t.http()).get("/settings/store").set(bearer(staff.token))).status).toBe(403);
      const before = await request(t.http()).get("/settings/store").set(bearer(ownerToken));
      expect(before.body["inventory.adjustmentApprovalThreshold"]).toBe("5000");

      expect((await adjust("-10")).status).toBe(201); // 1,000 Birr, under 5,000
      const lowered = await request(t.http())
        .patch("/settings/store")
        .set(bearer(ownerToken))
        .send({ adjustmentApprovalThreshold: "500" });
      expect(lowered.status).toBe(200);
      expect(lowered.body["inventory.adjustmentApprovalThreshold"]).toBe("500");
      expect((await adjust("-10")).body.code).toBe("APPROVAL_REQUIRED"); // now over the limit

      for (const bad of ["abc", "-5"]) {
        const res = await request(t.http())
          .patch("/settings/store")
          .set(bearer(ownerToken))
          .send({ adjustmentApprovalThreshold: bad });
        expect(res.status).toBe(400);
      }
      const audit = await t.prisma.auditLog.findFirstOrThrow({ where: { action: "UPDATE_SETTING" } });
      expect(audit.userId).toBe(ownerId);
    });
  });
});

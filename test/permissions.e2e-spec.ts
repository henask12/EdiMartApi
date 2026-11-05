import { Controller, Get } from "@nestjs/common";
import { DiscoveryService, Reflector } from "@nestjs/core";
import { PermissionKey } from "@prisma/client";
import request from "supertest";
import { AnyAuthenticated, RequirePermissions } from "../src/common/decorators/permissions.decorator";
import { Public } from "../src/common/decorators/public.decorator";
import { PERMISSION_CATALOG, GROUP_ORDER } from "../src/permissions/permission-catalog";
import { findUnguardedRoutes } from "../src/permissions/permission-coverage";
import { userWithPermissions } from "./access-helpers";
import { TestApp, bearer, close, createTestApp, login, resetData, seedBasics } from "./helpers";

const K = PermissionKey;

type Rule = {
  method: "get" | "post" | "patch" | "put" | "delete";
  path: string;
  /** Needs ALL of these. */
  all?: PermissionKey[];
  /** Needs AT LEAST ONE of these. */
  any?: PermissionKey[];
};

/**
 * Every business route and what it requires. The test below checks each one two ways: a user with
 * no permissions is refused, and a user holding just the required permission(s) is let through
 * the authorisation check (they may still get 400/404 for a dummy body or id, never 403).
 */
const RULES: Rule[] = [
  { method: "get", path: "/products", all: [K.PRODUCTS_VIEW] },
  { method: "get", path: "/products/some-id", all: [K.PRODUCTS_VIEW] },
  { method: "get", path: "/products/export", all: [K.PRODUCTS_EXPORT] },
  { method: "post", path: "/products", all: [K.PRODUCTS_CREATE] },
  { method: "patch", path: "/products/some-id", any: [K.PRODUCTS_EDIT, K.PRODUCTS_DEACTIVATE] },
  { method: "get", path: "/categories", all: [K.PRODUCTS_VIEW] },
  { method: "get", path: "/categories/some-id", all: [K.PRODUCTS_VIEW] },
  { method: "post", path: "/categories", all: [K.CATEGORIES_MANAGE] },
  { method: "patch", path: "/categories/some-id", all: [K.CATEGORIES_MANAGE] },
  { method: "delete", path: "/categories/some-id", all: [K.CATEGORIES_MANAGE] },
  { method: "get", path: "/product-types", all: [K.PRODUCTS_VIEW] },
  { method: "get", path: "/product-types/some-id", all: [K.PRODUCTS_VIEW] },
  { method: "post", path: "/product-types", all: [K.PRODUCT_TYPES_MANAGE] },
  { method: "patch", path: "/product-types/some-id", all: [K.PRODUCT_TYPES_MANAGE] },
  { method: "delete", path: "/product-types/some-id", all: [K.PRODUCT_TYPES_MANAGE] },
  { method: "get", path: "/inventory/expiry", all: [K.STOCK_VIEW] },
  { method: "get", path: "/inventory/movements", all: [K.STOCK_HISTORY_VIEW] },
  { method: "post", path: "/inventory/adjust", all: [K.STOCK_ADJUST] },
  { method: "post", path: "/inventory/return", all: [K.STOCK_ADJUST] },
  { method: "post", path: "/inventory/write-off", all: [K.STOCK_WRITE_OFF] },
  { method: "get", path: "/inventory/overview", all: [K.STOCK_VIEW] },
  { method: "get", path: "/inventory/lookup?q=test", all: [K.STOCK_VIEW] },
  { method: "post", path: "/inventory/quarantine", all: [K.STOCK_ADJUST] },
  { method: "get", path: "/inventory/replenishment", all: [K.STOCK_VIEW] },
  { method: "post", path: "/inventory/snapshot", all: [K.STOCK_VIEW] },
  { method: "post", path: "/imports/products/preview", all: [K.PRODUCTS_CREATE] },
  { method: "post", path: "/imports/products/commit", all: [K.PRODUCTS_CREATE] },
  { method: "post", path: "/stock/receive", all: [K.STOCK_RECEIVE] },
  { method: "get", path: "/stock/history", all: [K.STOCK_HISTORY_VIEW] },
  { method: "get", path: "/stock/history/some-id", all: [K.STOCK_HISTORY_VIEW] },
  { method: "get", path: "/stock/history/export", all: [K.STOCK_HISTORY_VIEW] },
  { method: "get", path: "/stock/batches?productId=x", all: [K.STOCK_HISTORY_VIEW] },
  { method: "post", path: "/stock/receive-batch", all: [K.STOCK_RECEIVE] },
  // Transfers
  { method: "get", path: "/transfers", all: [K.STOCK_TRANSFER] },
  { method: "get", path: "/transfers/some-id", all: [K.STOCK_TRANSFER] },
  { method: "post", path: "/transfers", all: [K.STOCK_TRANSFER] },
  { method: "post", path: "/transfers/some-id/send", all: [K.STOCK_TRANSFER] },
  { method: "post", path: "/transfers/some-id/receive", all: [K.STOCK_TRANSFER] },
  { method: "post", path: "/transfers/some-id/cancel", all: [K.STOCK_TRANSFER] },
  // Stock counts
  { method: "get", path: "/stock-counts", all: [K.STOCK_COUNT] },
  { method: "get", path: "/stock-counts/some-id", all: [K.STOCK_COUNT] },
  { method: "post", path: "/stock-counts", all: [K.STOCK_COUNT] },
  { method: "post", path: "/stock-counts/some-id/start", all: [K.STOCK_COUNT] },
  { method: "post", path: "/stock-counts/some-id/lines", all: [K.STOCK_COUNT] },
  { method: "post", path: "/stock-counts/some-id/post", all: [K.STOCK_COUNT_APPROVE] },
  // Prices
  { method: "post", path: "/prices/change", all: [K.PRICES_MANAGE] },
  { method: "get", path: "/prices/history?productId=x", all: [K.PRICES_MANAGE] },
  // Labels
  { method: "get", path: "/labels/pending", all: [K.LABELS_PRINT] },
  { method: "post", path: "/labels/printed", all: [K.LABELS_PRINT] },
  // Locations
  { method: "post", path: "/locations", all: [K.LOCATIONS_MANAGE] },
  { method: "patch", path: "/locations/some-id", all: [K.LOCATIONS_MANAGE] },
  { method: "get", path: "/sales/export", all: [K.SALES_EXPORT] },
  { method: "get", path: "/sales/today-summary", all: [K.REPORTING_VIEW] },
  { method: "get", path: "/sales/parked", all: [K.SALES_CREATE] },
  { method: "post", path: "/sales/park", all: [K.SALES_CREATE] },
  { method: "delete", path: "/sales/parked/some-id", all: [K.SALES_CREATE] },
  { method: "post", path: "/sales/parked/some-id/resume", all: [K.SALES_CREATE] },
  { method: "get", path: "/sales", any: [K.SALES_VIEW, K.SALES_VIEW_OWN, K.SALES_VIEW_ALL] },
  { method: "post", path: "/sales/checkout", all: [K.SALES_CREATE] },
  { method: "get", path: "/sales/some-id/receipt", any: [K.SALES_VIEW, K.SALES_VIEW_OWN, K.SALES_VIEW_ALL] },
  { method: "post", path: "/sales/some-id/void", all: [K.SALES_VOID] },
  { method: "post", path: "/sales/some-id/return", all: [K.SALES_REFUND] },
  { method: "get", path: "/sales/some-id", any: [K.SALES_VIEW, K.SALES_VIEW_OWN, K.SALES_VIEW_ALL] },
  { method: "get", path: "/reporting/dashboard", all: [K.REPORTING_VIEW] },
  { method: "get", path: "/reporting/sales?period=day", all: [K.REPORTING_VIEW] },
  { method: "get", path: "/reservations", all: [K.RESERVATIONS_MANAGE] },
  { method: "post", path: "/reservations", all: [K.PRODUCTS_RESERVE] },
  { method: "patch", path: "/reservations/some-id", all: [K.RESERVATIONS_MANAGE] },
  { method: "post", path: "/reservations/some-id/update", all: [K.RESERVATIONS_MANAGE] },
  { method: "post", path: "/reservations/some-id/cancel", all: [K.RESERVATIONS_MANAGE] },
  { method: "post", path: "/reservations/some-id/complete", all: [K.RESERVATIONS_MANAGE, K.SALES_CREATE] },
  { method: "post", path: "/uploads/product-image", any: [K.PRODUCTS_CREATE, K.PRODUCTS_EDIT] },
  { method: "post", path: "/uploads/sale-proof", all: [K.SALES_CREATE] },
  { method: "get", path: "/settings/notification-emails", all: [K.SETTINGS_EMAILS] },
  { method: "post", path: "/settings/notification-emails", all: [K.SETTINGS_EMAILS] },
  { method: "patch", path: "/settings/notification-emails/some-id", all: [K.SETTINGS_EMAILS] },
  { method: "delete", path: "/settings/notification-emails/some-id", all: [K.SETTINGS_EMAILS] },
  { method: "get", path: "/settings/store", all: [K.SETTINGS_MANAGE] },
  { method: "patch", path: "/settings/store", all: [K.SETTINGS_MANAGE] },
  { method: "post", path: "/registers", all: [K.SETTINGS_MANAGE] },
  { method: "patch", path: "/registers/some-id", all: [K.SETTINGS_MANAGE] },
  { method: "get", path: "/shifts", any: [K.SHIFT_MANAGE, K.SHIFT_VIEW_ALL] },
  { method: "get", path: "/shifts/current", all: [K.SHIFT_MANAGE] },
  { method: "post", path: "/shifts/open", all: [K.SHIFT_MANAGE] },
  { method: "get", path: "/shifts/some-id/x-report", any: [K.SHIFT_MANAGE, K.SHIFT_VIEW_ALL] },
  { method: "get", path: "/shifts/some-id/z-report", any: [K.SHIFT_MANAGE, K.SHIFT_VIEW_ALL] },
  { method: "post", path: "/shifts/some-id/cash-in", all: [K.SHIFT_MANAGE] },
  { method: "post", path: "/shifts/some-id/cash-out", all: [K.SHIFT_MANAGE] },
  { method: "post", path: "/shifts/some-id/no-sale", all: [K.SHIFT_MANAGE] },
  { method: "post", path: "/shifts/some-id/close", all: [K.SHIFT_MANAGE] },
  { method: "get", path: "/shifts/some-id", any: [K.SHIFT_MANAGE, K.SHIFT_VIEW_ALL] },
  // Suppliers
  { method: "get", path: "/suppliers", any: [K.PRODUCTS_VIEW, K.SUPPLIERS_MANAGE] },
  { method: "post", path: "/suppliers", all: [K.SUPPLIERS_MANAGE] },
  { method: "get", path: "/suppliers/some-id/products", any: [K.PRODUCTS_VIEW, K.SUPPLIERS_MANAGE] },
  { method: "post", path: "/suppliers/some-id/products", all: [K.SUPPLIERS_MANAGE] },
  {
    method: "get",
    path: "/suppliers/some-id/products/some-product/cost-history",
    any: [K.PRODUCTS_VIEW, K.SUPPLIERS_MANAGE],
  },
  { method: "get", path: "/suppliers/some-id", any: [K.PRODUCTS_VIEW, K.SUPPLIERS_MANAGE] },
  { method: "patch", path: "/suppliers/some-id", all: [K.SUPPLIERS_MANAGE] },
  // Purchase orders
  { method: "get", path: "/purchase-orders", all: [K.PURCHASING_MANAGE] },
  { method: "post", path: "/purchase-orders", all: [K.PURCHASING_MANAGE] },
  { method: "post", path: "/purchase-orders/some-id/approve", all: [K.PURCHASING_MANAGE] },
  { method: "post", path: "/purchase-orders/some-id/send", all: [K.PURCHASING_MANAGE] },
  { method: "post", path: "/purchase-orders/some-id/cancel", all: [K.PURCHASING_MANAGE] },
  { method: "post", path: "/purchase-orders/some-id/close", all: [K.PURCHASING_MANAGE] },
  { method: "get", path: "/purchase-orders/some-id", all: [K.PURCHASING_MANAGE] },
  { method: "patch", path: "/purchase-orders/some-id", all: [K.PURCHASING_MANAGE] },
  // Goods receipts
  { method: "get", path: "/goods-receipts", all: [K.PURCHASING_MANAGE] },
  { method: "post", path: "/goods-receipts", all: [K.PURCHASING_MANAGE] },
  { method: "post", path: "/goods-receipts/some-id/landed-costs", all: [K.PURCHASING_MANAGE] },
  { method: "get", path: "/goods-receipts/some-id", all: [K.PURCHASING_MANAGE] },
  // Purchasing helpers / reorder
  { method: "get", path: "/purchasing/incoming", all: [K.PURCHASING_MANAGE] },
  { method: "get", path: "/purchasing/reorder-suggestions", all: [K.PURCHASING_MANAGE] },
  { method: "post", path: "/purchasing/reorder-suggestions/create-pos", all: [K.PURCHASING_MANAGE] },
  // Supplier bills
  { method: "get", path: "/supplier-bills/aged-payables", all: [K.SUPPLIER_PAYMENTS_MANAGE] },
  { method: "get", path: "/supplier-bills", all: [K.SUPPLIER_PAYMENTS_MANAGE] },
  { method: "post", path: "/supplier-bills", all: [K.SUPPLIER_PAYMENTS_MANAGE] },
  { method: "post", path: "/supplier-bills/some-id/payments", all: [K.SUPPLIER_PAYMENTS_MANAGE] },
  { method: "get", path: "/supplier-bills/some-id", all: [K.SUPPLIER_PAYMENTS_MANAGE] },
  // Supplier returns
  { method: "get", path: "/supplier-returns", all: [K.PURCHASING_MANAGE] },
  { method: "post", path: "/supplier-returns", all: [K.PURCHASING_MANAGE] },
  { method: "post", path: "/supplier-returns/some-id/complete", all: [K.PURCHASING_MANAGE] },
  { method: "post", path: "/supplier-returns/some-id/cancel", all: [K.PURCHASING_MANAGE] },
  { method: "get", path: "/supplier-returns/some-id", all: [K.PURCHASING_MANAGE] },
  // Customers / loyalty / credit
  { method: "get", path: "/customers", all: [K.CUSTOMERS_VIEW] },
  { method: "post", path: "/customers", all: [K.CUSTOMERS_MANAGE] },
  { method: "get", path: "/customers/overdue", all: [K.CUSTOMERS_VIEW] },
  { method: "get", path: "/customers/some-id/ledger", all: [K.CUSTOMERS_VIEW] },
  { method: "get", path: "/customers/some-id/loyalty", all: [K.CUSTOMERS_VIEW] },
  { method: "get", path: "/customers/some-id/statement", all: [K.CUSTOMERS_VIEW] },
  { method: "get", path: "/customers/some-id", all: [K.CUSTOMERS_VIEW] },
  { method: "patch", path: "/customers/some-id", all: [K.CUSTOMERS_MANAGE] },
  { method: "post", path: "/customers/some-id/repay", all: [K.CUSTOMER_CREDIT_MANAGE] },
  { method: "post", path: "/customers/some-id/credit-limit", all: [K.CUSTOMER_CREDIT_MANAGE] },
  { method: "post", path: "/customers/some-id/adjust-store-credit", all: [K.CUSTOMER_CREDIT_MANAGE] },
  // Promotions
  { method: "get", path: "/promotions", any: [K.CUSTOMERS_VIEW, K.PROMOTIONS_MANAGE] },
  { method: "post", path: "/promotions", all: [K.PROMOTIONS_MANAGE] },
  { method: "post", path: "/promotions/evaluate", any: [K.CUSTOMERS_VIEW, K.PROMOTIONS_MANAGE] },
  { method: "get", path: "/promotions/some-id/usage", any: [K.CUSTOMERS_VIEW, K.PROMOTIONS_MANAGE] },
  { method: "get", path: "/promotions/some-id", any: [K.CUSTOMERS_VIEW, K.PROMOTIONS_MANAGE] },
  { method: "patch", path: "/promotions/some-id", all: [K.PROMOTIONS_MANAGE] },
  { method: "get", path: "/users", all: [K.USERS_MANAGE] },
  { method: "post", path: "/users", all: [K.USERS_MANAGE] },
  { method: "patch", path: "/users/some-id", all: [K.USERS_MANAGE] },
  { method: "post", path: "/users/some-id/reset-password", all: [K.USERS_MANAGE] },
  { method: "get", path: "/roles", all: [K.ROLES_MANAGE] },
  { method: "get", path: "/roles/permissions", all: [K.ROLES_MANAGE] },
  { method: "post", path: "/roles", all: [K.ROLES_MANAGE] },
  { method: "get", path: "/roles/some-id", all: [K.ROLES_MANAGE] },
  { method: "patch", path: "/roles/some-id", all: [K.ROLES_MANAGE] },
  { method: "patch", path: "/roles/some-id/permissions", all: [K.ROLES_MANAGE] },
  { method: "delete", path: "/roles/some-id", all: [K.ROLES_MANAGE] },
  { method: "get", path: "/roles/some-id/users", all: [K.ROLES_MANAGE] },
];

/** Routes any signed-in user may call (they only touch the caller's own data). */
const ANY_SIGNED_IN: Pick<Rule, "method" | "path">[] = [
  { method: "get", path: "/auth/me" },
  { method: "patch", path: "/auth/me" },
  { method: "post", path: "/auth/change-password" },
  { method: "put", path: "/auth/pin" },
  { method: "get", path: "/approvals/managers?action=SALE_VOID" },
  { method: "post", path: "/approvals" },
  { method: "get", path: "/locations" },
  { method: "get", path: "/locations/some-id" },
  { method: "get", path: "/registers" },
];

describe("one permission model", () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => close(t));
  beforeEach(async () => {
    await resetData(t.prisma);
    await seedBasics(t.prisma);
  });

  const call = (token: string, rule: Pick<Rule, "method" | "path">) =>
    request(t.http())[rule.method](rule.path).set(bearer(token)).send({});

  describe("route coverage", () => {
    it("every route of the running app declares who may call it", () => {
      const controllers = t.app
        .get(DiscoveryService)
        .getControllers()
        .map((w) => w.metatype as never);
      expect(findUnguardedRoutes(controllers, t.app.get(Reflector))).toEqual([]);
    });

    it("the check does catch a route that declares nothing", () => {
      @Controller("probe")
      class Probe {
        @Get("open-by-mistake")
        forgotten() {
          return 1;
        }
        @Get("fine")
        @RequirePermissions(PermissionKey.PRODUCTS_VIEW)
        guarded() {
          return 1;
        }
        @Get("me")
        @AnyAuthenticated()
        mine() {
          return 1;
        }
        @Get("public")
        @Public()
        everyone() {
          return 1;
        }
      }
      const missing = findUnguardedRoutes([Probe], t.app.get(Reflector));
      expect(missing).toEqual([{ route: "GET /probe/open-by-mistake", handler: "Probe.forgotten" }]);
    });

    it("the matrix below lists every business route (nothing was forgotten when it was written)", () => {
      const listed = new Set(RULES.map((r) => `${r.method} ${r.path.split("?")[0].replace("/some-id", "/:id")}`));
      const anyIn = new Set(ANY_SIGNED_IN.map((r) => `${r.method} ${r.path.split("?")[0]}`));
      expect(listed.size).toBe(RULES.length);
      expect(anyIn.size).toBe(ANY_SIGNED_IN.length);
    });
  });

  describe("each route enforces exactly its permission", () => {
    it.each(RULES.map((r) => [`${r.method.toUpperCase()} ${r.path}`, r] as const))(
      "%s",
      async (_name, rule) => {
        const none = await userWithPermissions(t, [], "none");
        expect((await call(none.token, rule)).status).toBe(403);

        const required = rule.all ?? rule.any ?? [];
        // holding only SOME of an "all" set is not enough
        if (rule.all && rule.all.length > 1) {
          for (const missingOne of rule.all) {
            const partial = await userWithPermissions(
              t,
              rule.all.filter((k) => k !== missingOne),
              "partial",
            );
            expect((await call(partial.token, rule)).status).toBe(403);
          }
        }
        // any single key of an "any" set, or the whole "all" set, passes authorisation
        const holders = rule.any ? rule.any.map((k) => [k]) : [required];
        for (const keys of holders) {
          const allowed = await userWithPermissions(t, keys, "allowed");
          const status = (await call(allowed.token, rule)).status;
          expect([401, 403]).not.toContain(status);
        }
      },
    );

    it.each(ANY_SIGNED_IN.map((r) => [`${r.method.toUpperCase()} ${r.path}`, r] as const))(
      "%s is open to any signed-in user, and to nobody else",
      async (_name, rule) => {
        const none = await userWithPermissions(t, [], "none");
        expect([401, 403]).not.toContain((await call(none.token, rule)).status);
        expect((await request(t.http())[rule.method](rule.path).send({})).status).toBe(401);
      },
    );

    it("the owner passes every check (the only automatic bypass)", async () => {
      const owner = await login(t, "owner@test.local");
      for (const rule of [...RULES, ...ANY_SIGNED_IN]) {
        const status = (await call(owner, rule)).status;
        expect([401, 403]).not.toContain(status);
      }
    });

    it("an inactive route list: public routes stay public", async () => {
      expect((await request(t.http()).get("/health")).status).toBe(200);
      expect((await request(t.http()).get("/")).status).toBe(200);
      // Signed digital receipt is public; a garbage token still must not require auth (404).
      expect((await request(t.http()).get("/sales/receipt/not-a-valid-token")).status).toBe(404);
    });
  });

  describe("roles hold exactly what is stored", () => {
    it("a built-in role with every permission removed can do nothing (no fallback to defaults)", async () => {
      const cashierRole = await t.prisma.role.findUniqueOrThrow({ where: { name: "CASHIER" } });
      await t.prisma.rolePermission.deleteMany({ where: { roleId: cashierRole.id } });
      const token = await login(t, "cashier@test.local");
      expect((await request(t.http()).get("/products").set(bearer(token))).status).toBe(403);
      const me = await request(t.http()).get("/auth/me").set(bearer(token));
      expect(me.body.permissions).toEqual([]);
    });

    it("/auth/me lists the stored permissions, and everything for the owner", async () => {
      const cashierToken = await login(t, "cashier@test.local");
      const ownerToken = await login(t, "owner@test.local");
      const cashier = await request(t.http()).get("/auth/me").set(bearer(cashierToken));
      expect(cashier.body.permissions).toEqual(expect.arrayContaining(["SALES_CREATE", "SALES_VIEW_ALL"]));
      expect(cashier.body.permissions).not.toContain("STOCK_ADJUST");
      expect(cashier.body.permissions).not.toContain("REPORTS_VIEW_COST_PROFIT");
      const owner = await request(t.http()).get("/auth/me").set(bearer(ownerToken));
      expect(owner.body.permissions).toHaveLength(Object.values(PermissionKey).length);
    });
  });

  describe("the permission catalog", () => {
    it("describes every permission exactly once, in a known group", () => {
      const keys = PERMISSION_CATALOG.map((p) => p.key);
      expect(new Set(keys).size).toBe(keys.length);
      expect([...keys].sort()).toEqual(Object.values(PermissionKey).sort());
      for (const p of PERMISSION_CATALOG) {
        expect(p.label.length).toBeGreaterThan(3);
        expect(p.description.length).toBeGreaterThan(10);
        expect(GROUP_ORDER).toContain(p.group);
        if (p.status === "planned") expect(p.plannedPhase).toBeGreaterThan(1);
      }
    });

    it("is served to the Roles screen, and marks the money-related keys as sensitive", async () => {
      const owner = await login(t, "owner@test.local");
      const res = await request(t.http()).get("/roles/permissions").set(bearer(owner));
      expect(res.status).toBe(200);
      expect(res.body.groups).toEqual(GROUP_ORDER);
      const byKey = Object.fromEntries(res.body.permissions.map((p: { key: string }) => [p.key, p]));
      for (const key of ["REPORTS_VIEW_COST_PROFIT", "STOCK_ADJUST", "SALES_REFUND", "USERS_MANAGE", "ROLES_MANAGE"]) {
        expect(byKey[key].sensitive).toBe(true);
      }
      expect(byKey.PRODUCTS_VIEW.sensitive).toBe(false);
    });
  });

  describe("nobody can hand out more than they hold", () => {
    it("a role manager cannot grant what they lack, edit their own role, or create a stronger role", async () => {
      const manager = await userWithPermissions(
        t,
        [K.ROLES_MANAGE, K.USERS_MANAGE, K.PRODUCTS_VIEW],
        "rolemgr",
      );
      const target = await userWithPermissions(t, [K.PRODUCTS_VIEW], "target");

      // cannot give a role something they do not have themselves
      const grantMore = await request(t.http())
        .patch(`/roles/${target.role.id}/permissions`)
        .set(bearer(manager.token))
        .send({ permissions: [K.PRODUCTS_VIEW, K.REPORTS_VIEW_COST_PROFIT] });
      expect(grantMore.status).toBe(403);

      // cannot edit their own role at all
      const own = await request(t.http())
        .patch(`/roles/${manager.role.id}/permissions`)
        .set(bearer(manager.token))
        .send({ permissions: [K.ROLES_MANAGE, K.USERS_MANAGE, K.PRODUCTS_VIEW, K.STOCK_ADJUST] });
      expect(own.status).toBe(403);

      // cannot create a role stronger than themselves
      const stronger = await request(t.http())
        .post("/roles")
        .set(bearer(manager.token))
        .send({ name: "Big", permissions: [K.PRODUCTS_VIEW, K.SALES_REFUND] });
      expect(stronger.status).toBe(403);

      // can create or change a role within their own permissions
      const within = await request(t.http())
        .post("/roles")
        .set(bearer(manager.token))
        .send({ name: "Viewer", permissions: [K.PRODUCTS_VIEW] });
      expect(within.status).toBe(201);
      const narrower = await request(t.http())
        .patch(`/roles/${target.role.id}/permissions`)
        .set(bearer(manager.token))
        .send({ permissions: [] });
      expect(narrower.status).toBe(200);
    });

    it("a user manager cannot create an owner, promote someone to a stronger role, or touch the owner", async () => {
      const manager = await userWithPermissions(t, [K.USERS_MANAGE, K.PRODUCTS_VIEW], "usermgr");
      const strong = await userWithPermissions(t, [K.PRODUCTS_VIEW, K.STOCK_ADJUST], "strong");
      const weak = await userWithPermissions(t, [K.PRODUCTS_VIEW], "weak");
      const owner = await t.prisma.user.findUniqueOrThrow({ where: { email: "owner@test.local" } });

      const makeOwner = await request(t.http())
        .post("/users")
        .set(bearer(manager.token))
        .send({ email: "sneaky@test.local", password: "Temp-Pass-12345", role: "OWNER" });
      expect(makeOwner.status).toBe(403);

      const stronger = await request(t.http())
        .post("/users")
        .set(bearer(manager.token))
        .send({ email: "stronger@test.local", password: "Temp-Pass-12345", role: strong.role.name });
      expect(stronger.status).toBe(403);

      const promote = await request(t.http())
        .patch(`/users/${weak.user.id}`)
        .set(bearer(manager.token))
        .send({ roleId: strong.role.id });
      expect(promote.status).toBe(403);

      const takeover = await request(t.http())
        .post(`/users/${owner.id}/reset-password`)
        .set(bearer(manager.token))
        .send({ password: "Hijacked-Pass-1" });
      expect(takeover.status).toBe(403);
      const resetStronger = await request(t.http())
        .post(`/users/${strong.user.id}/reset-password`)
        .set(bearer(manager.token))
        .send({ password: "Hijacked-Pass-2" });
      expect(resetStronger.status).toBe(403);

      const fine = await request(t.http())
        .post("/users")
        .set(bearer(manager.token))
        .send({ email: "fine@test.local", password: "Temp-Pass-12345", role: weak.role.name });
      expect(fine.status).toBe(201);
    });

    it("the owner can do all of it", async () => {
      const ownerToken = await login(t, "owner@test.local");
      const role = await request(t.http())
        .post("/roles")
        .set(bearer(ownerToken))
        .send({ name: "Manager", permissions: [K.STOCK_ADJUST, K.REPORTS_VIEW_COST_PROFIT, K.SALES_REFUND] });
      expect(role.status).toBe(201);
      const user = await request(t.http())
        .post("/users")
        .set(bearer(ownerToken))
        .send({ email: "mgr@test.local", password: "Temp-Pass-12345", role: "MANAGER" });
      expect(user.status).toBe(201);
    });
  });
});

import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { PermissionKey } from "@prisma/client";
import { TEST_DB_PORT } from "./env";
import { SENSITIVE_PERMISSIONS } from "../src/permissions/permission-catalog";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { Client } = require("pg") as typeof import("pg");

const MIGRATIONS = join(__dirname, "..", "prisma", "migrations");
const BEFORE_PHASE_1 = "20251105000000_phase1_permission_keys";
const DB = "edimart_backfill";

const url = (db: string) => `postgresql://postgres:postgres@127.0.0.1:${TEST_DB_PORT}/${db}`;
const sqlOf = (dir: string) => readFileSync(join(MIGRATIONS, dir, "migration.sql"), "utf8");
const migrationDirs = () =>
  readdirSync(MIGRATIONS)
    .filter((d) => /^\d{14}_/.test(d))
    .sort();

describe("Phase 1 backfill on a database in its pre-Phase-1 state", () => {
  const admin = new Client({ connectionString: url("postgres") });
  const db = new Client({ connectionString: url(DB) });

  const permissionsOf = async (role: string) =>
    (
      await db.query<{ permission: string }>(
        `SELECT rp."permission"::text AS permission FROM "RolePermission" rp
           JOIN "Role" r ON r."id" = rp."roleId" WHERE r."name" = $1 ORDER BY 1`,
        [role],
      )
    ).rows.map((r) => r.permission);

  const allPermissionRows = async () =>
    (await db.query<{ permission: string }>(`SELECT DISTINCT "permission"::text AS permission FROM "RolePermission"`)).rows.map(
      (r) => r.permission,
    );

  let before: string[];

  beforeAll(async () => {
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin.query(`CREATE DATABASE ${DB}`);
    await db.connect();

    // 1. build the database exactly as production had it before Phase 1
    for (const dir of migrationDirs().filter((d) => d < BEFORE_PHASE_1)) {
      await db.query(sqlOf(dir));
    }

    // 2. old-style data: built-in roles WITHOUT stored rows (they used the code defaults), one
    //    built-in role the owner had customised, and custom roles
    await db.query(`
      INSERT INTO "Role" ("id", "name", "isProtected") VALUES
        ('r_owner', 'OWNER', true), ('r_cashier', 'CASHIER', false), ('r_staff', 'STORE_STAFF', false),
        ('r_online', 'ONLINE_MANAGER', false), ('r_empty', 'CUSTOM_EMPTY', false), ('r_view', 'CUSTOM_VIEW', false),
        ('r_admin', 'CUSTOM_ADMIN', false);
      -- STORE_STAFF was customised by the owner: only these four
      INSERT INTO "RolePermission" ("roleId", "permission") VALUES
        ('r_staff', 'PRODUCTS_VIEW'), ('r_staff', 'SALES_VIEW'), ('r_staff', 'STOCK_HISTORY_VIEW'), ('r_staff', 'SALES_CREATE'),
        ('r_view', 'SALES_VIEW'),
        ('r_admin', 'USERS_MANAGE'), ('r_admin', 'ROLES_MANAGE'), ('r_admin', 'PRODUCTS_DEACTIVATE');
      INSERT INTO "User" ("id", "email", "passwordHash", "roleId", "updatedAt")
        VALUES ('u1', 'keep@test.local', 'hash', 'r_cashier', NOW());
    `);
    before = await allPermissionRows();

    // 3. apply Phase 1
    for (const dir of migrationDirs().filter((d) => d >= BEFORE_PHASE_1)) {
      await db.query(sqlOf(dir));
    }
  });

  afterAll(async () => {
    await db.end();
    await admin.query(`DROP DATABASE IF EXISTS ${DB}`).catch(() => undefined);
    await admin.end();
  });

  it("adds every new permission key to the database enum", async () => {
    const { rows } = await db.query<{ value: string }>(`SELECT unnest(enum_range(NULL::"PermissionKey"))::text AS value`);
    expect(rows.map((r) => r.value).sort()).toEqual(Object.values(PermissionKey).sort());
  });

  it("writes the old code defaults out as real rows for built-in roles that had none", async () => {
    expect(await permissionsOf("CASHIER")).toEqual(
      [
        "PRODUCTS_VIEW", "PRODUCTS_EDIT", "PRODUCTS_SELL", "PRODUCTS_RESERVE", "PRODUCTS_EXPORT",
        "SALES_CREATE", "SALES_VIEW", "SALES_VIEW_ALL", "SALES_EXPORT", "RESERVATIONS_MANAGE", "REPORTING_VIEW",
      ].sort(),
    );
    expect(await permissionsOf("ONLINE_MANAGER")).toEqual(["PRODUCTS_VIEW"]);
    expect((await permissionsOf("STORE_STAFF")).length).toBeGreaterThan(0);
  });

  it("leaves a role the owner had customised exactly as it was (plus the equivalent new keys)", async () => {
    expect(await permissionsOf("STORE_STAFF")).toEqual(
      ["PRODUCTS_VIEW", "SALES_VIEW", "SALES_VIEW_ALL", "STOCK_HISTORY_VIEW", "STOCK_VIEW", "SALES_CREATE"].sort(),
    );
  });

  it("does not hand custom roles anything they did not have", async () => {
    expect(await permissionsOf("CUSTOM_EMPTY")).toEqual([]);
    expect(await permissionsOf("CUSTOM_VIEW")).toEqual(["SALES_VIEW", "SALES_VIEW_ALL"]);
    expect(await permissionsOf("CUSTOM_ADMIN")).toEqual(["PRODUCTS_DEACTIVATE", "ROLES_MANAGE", "USERS_MANAGE"]);
    expect(await permissionsOf("OWNER")).toEqual([]); // the owner is automatic, never stored
  });

  it("never switches on a sensitive permission that was not already on", async () => {
    const after = await allPermissionRows();
    // everything the old code defaults already gave the built-in roles (now written out as rows)
    const oldDefaults = [
      "PRODUCTS_VIEW", "PRODUCTS_CREATE", "PRODUCTS_EDIT", "PRODUCTS_SELL", "PRODUCTS_RESERVE", "PRODUCTS_RESTOCK",
      "PRODUCTS_EXPORT", "CATEGORIES_MANAGE", "PRODUCT_TYPES_MANAGE", "STOCK_RECEIVE", "STOCK_HISTORY_VIEW",
      "SALES_CREATE", "SALES_VIEW", "SALES_EXPORT", "RESERVATIONS_MANAGE", "REPORTING_VIEW",
    ];
    const known = new Set([...before, ...oldDefaults]);
    const added = after.filter((p) => !known.has(p));
    // the only genuinely new keys are the two that mean what an existing key already meant
    expect(added.sort()).toEqual(["SALES_VIEW_ALL", "STOCK_VIEW"]);
    const newlySensitive = added.filter((p) => SENSITIVE_PERMISSIONS.has(p as PermissionKey));
    expect(newlySensitive).toEqual([]);
    for (const key of ["STOCK_ADJUST", "REPORTS_VIEW_COST_PROFIT", "SALES_VOID", "SALES_REFUND", "STOCK_COUNT_APPROVE"]) {
      expect(after).not.toContain(key);
    }
  });

  it("keeps existing users and adds the PIN columns with safe defaults", async () => {
    const { rows } = await db.query(
      `SELECT "email", "pinHash", "pinFailedAttempts", "pinLockedUntil" FROM "User" WHERE "id" = 'u1'`,
    );
    expect(rows).toEqual([{ email: "keep@test.local", pinHash: null, pinFailedAttempts: 0, pinLockedUntil: null }]);
  });

  it("can be applied twice without duplicating or changing anything (the data part is idempotent)", async () => {
    const countBefore = (await db.query(`SELECT COUNT(*)::int AS n FROM "RolePermission"`)).rows[0].n;
    const sql = sqlOf("20251105000100_phase1_permissions_backfill");
    await db.query(sql.slice(sql.indexOf('INSERT INTO "RolePermission"')));
    expect((await db.query(`SELECT COUNT(*)::int AS n FROM "RolePermission"`)).rows[0].n).toBe(countBefore);
  });
});

import { randomBytes } from "crypto";
import { MovementType, Prisma, PrismaClient } from "@prisma/client";
import * as bcrypt from "bcryptjs";
import {
  BUILTIN_ROLES,
  CASHIER_ROLE,
  OWNER_ROLE,
  STORE_STAFF_ROLE,
} from "../common/role.constants";
import { CATALOG_CATEGORIES, CATALOG_PRODUCTS } from "./catalog-seed-data";
import { DEFAULT_ROLE_PERMISSIONS } from "../permissions/role-defaults";

/** Thrown when the database already holds real data; the seed only ever runs on an empty one. */
export class SeedRefusedError extends Error {}

export type SeedOptions = {
  /** Where one-time credentials are announced (server logs). Never returned to callers. */
  log?: (message: string) => void;
  env?: NodeJS.ProcessEnv;
};

const MIN_PASSWORD_LENGTH = 10;

const hash = (password: string) => bcrypt.hash(password, 10);
const generatePassword = () => randomBytes(12).toString("base64url");

const autoSku = (name: string) =>
  `auto-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}-${Date.now().toString(36)}`;

/**
 * First-run data: built-in roles, the DEFAULT_STORE location, the owner account and the starter
 * catalogue with opening stock.
 *
 * - Refuses to run when the database already has users, sales or stock movements, so it can
 *   never overwrite live stock or reset real passwords.
 * - Owner password comes from ADMIN_INITIAL_PASSWORD, or is generated and printed once to the
 *   server log. Cashier/staff demo accounts are created only with SEED_DEMO_USERS=1.
 * - Every seeded account must change its password at first login.
 * - Opening stock is written as a receipt batch plus a RECEIPT movement, so the stock ledger
 *   agrees with on-hand from day one.
 */
export const runSeed = async (prisma: PrismaClient, options: SeedOptions = {}) => {
  const env = options.env ?? process.env;
  const log = options.log ?? (() => undefined);

  const [users, sales, movements] = await Promise.all([
    prisma.user.count(),
    prisma.sale.count(),
    prisma.stockMovement.count(),
  ]);
  if (users > 0 || sales > 0 || movements > 0) {
    throw new SeedRefusedError(
      "Seed refused: this database already has users, sales or stock movements.",
    );
  }

  const adminEmail = (env.ADMIN_EMAIL?.trim() || "owner@edisims.local").toLowerCase();
  const providedPassword = env.ADMIN_INITIAL_PASSWORD;
  if (providedPassword !== undefined && providedPassword.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`ADMIN_INITIAL_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  const ownerPassword = providedPassword || generatePassword();

  const roles = await Promise.all(
    BUILTIN_ROLES.map(async (name) =>
      prisma.role.upsert({
        where: { name },
        update: { isProtected: name === OWNER_ROLE },
        create: { name, isProtected: name === OWNER_ROLE },
      }),
    ),
  );
  const roleByName = (n: string) => roles.find((r) => r.name === n)!;

  // A role has exactly the permissions stored for it (the owner role is the only automatic one),
  // so write the built-in roles' starting permissions out as real rows.
  for (const role of roles) {
    if (role.name === OWNER_ROLE) continue;
    await prisma.rolePermission.createMany({
      data: (DEFAULT_ROLE_PERMISSIONS[role.name] ?? []).map((permission) => ({
        roleId: role.id,
        permission,
      })),
      skipDuplicates: true,
    });
  }

  const defaultLoc = await prisma.location.upsert({
    where: { code: "DEFAULT_STORE" },
    update: { name: "Shop floor", sellable: true, storeCode: "DEFAULT_STORE", sortOrder: 0 },
    create: { code: "DEFAULT_STORE", name: "Shop floor", sellable: true, storeCode: "DEFAULT_STORE", sortOrder: 0 },
  });

  await prisma.location.upsert({
    where: { code: "BACK_STORE" },
    update: { sellable: true, storeCode: "DEFAULT_STORE", sortOrder: 10 },
    create: { code: "BACK_STORE", name: "Back store", sellable: true, storeCode: "DEFAULT_STORE", sortOrder: 10 },
  });

  await prisma.location.upsert({
    where: { code: "QUARANTINE" },
    update: { sellable: false, storeCode: "DEFAULT_STORE", sortOrder: 20 },
    create: { code: "QUARANTINE", name: "Quarantine", sellable: false, storeCode: "DEFAULT_STORE", sortOrder: 20 },
  });

  await prisma.register.upsert({
    where: { code: "REGISTER-1" },
    update: { name: "Main till", isActive: true },
    create: {
      id: "reg_default_phase5",
      code: "REGISTER-1",
      name: "Main till",
      storeCode: "DEFAULT_STORE",
      isActive: true,
    },
  });

  await prisma.user.create({
    data: {
      email: adminEmail,
      displayName: "Shop Owner",
      passwordHash: await hash(ownerPassword),
      roleId: roleByName(OWNER_ROLE).id,
      mustChangePassword: true,
    },
  });
  if (!providedPassword) {
    log(
      `FIRST-RUN OWNER LOGIN (shown once, change it at first sign-in): ${adminEmail} / ${ownerPassword}`,
    );
  } else {
    log(`Owner account created for ${adminEmail} using ADMIN_INITIAL_PASSWORD.`);
  }

  if (env.SEED_DEMO_USERS === "1") {
    for (const [email, displayName, roleName] of [
      ["cashier@edisims.local", "Helper", CASHIER_ROLE],
      ["staff@edisims.local", "Staff", STORE_STAFF_ROLE],
    ] as const) {
      const password = generatePassword();
      await prisma.user.create({
        data: {
          email,
          displayName,
          passwordHash: await hash(password),
          roleId: roleByName(roleName).id,
          mustChangePassword: true,
        },
      });
      log(`DEMO LOGIN (shown once): ${email} / ${password}`);
    }
  }

  let productCount = 0;
  if (env.SEED_CATALOG !== "0") {
    const categoryByName = new Map<string, string>();
    for (const name of CATALOG_CATEGORIES) {
      const cat = await prisma.category.upsert({ where: { name }, update: {}, create: { name } });
      categoryByName.set(name, cat.id);
    }

    for (const p of CATALOG_PRODUCTS) {
      const categoryId = categoryByName.get(p.category);
      if (!categoryId) {
        throw new Error(`Missing category: ${p.category}`);
      }
      const cost = new Prisma.Decimal(p.costPrice ?? 0);
      const qty = new Prisma.Decimal(p.initialQuantity ?? 0);
      const product = await prisma.product.create({
        data: {
          sku: autoSku(p.name),
          name: p.name,
          categoryId,
          sellingPrice: p.sellingPrice,
          costPrice: cost,
          restockAt: p.restockAt ?? 0,
          restockQty: p.restockQty ?? 0,
          description: p.description ?? null,
          originCountry: p.originCountry ?? null,
        },
      });
      const inventory = await prisma.inventoryItem.create({
        data: {
          productId: product.id,
          locationId: defaultLoc.id,
          quantityOnHand: qty,
          averageCost: cost,
        },
      });
      if (qty.gt(0)) {
        const batch = await prisma.stockBatch.create({
          data: { productId: product.id, qtyReceived: qty, qtyRemaining: qty, unitCost: cost },
        });
        await prisma.stockMovement.create({
          data: {
            inventoryItemId: inventory.id,
            stockBatchId: batch.id,
            type: MovementType.RECEIPT,
            qtyDelta: qty,
            unitCost: cost,
            beforeOnHand: new Prisma.Decimal(0),
            afterOnHand: qty,
            refType: "STOCK_BATCH",
            refId: batch.id,
            notes: "Opening stock (seed)",
          },
        });
      }
      productCount += 1;
    }
  }

  await prisma.auditLog.create({
    data: { action: "SEED", entity: "System", metadata: { products: productCount } },
  });

  return {
    users: await prisma.user.count(),
    products: productCount,
  };
};

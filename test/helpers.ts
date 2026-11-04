import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { NestExpressApplication } from "@nestjs/platform-express";
import { MovementType, Prisma, PrismaClient } from "@prisma/client";
import * as bcrypt from "bcryptjs";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { configureApp } from "../src/app.setup";
import { BUILTIN_ROLES, OWNER_ROLE } from "../src/common/role.constants";
import { DEFAULT_ROLE_PERMISSIONS } from "../src/permissions/role-defaults";
import { PrismaService } from "../src/prisma/prisma.service";

export type TestApp = { app: NestExpressApplication; prisma: PrismaService; http: () => any };

export const createTestApp = async (): Promise<TestApp> => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app);
  await app.init();
  return { app, prisma: app.get(PrismaService), http: () => app.getHttpServer() };
};

/** Empty every table (keeps the schema and the migration history). */
export const resetData = async (prisma: PrismaClient) => {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
     WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  const list = tables.map((t) => `"${t.tablename}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
};

export const PASSWORD = "Test-Password-123";

/** Roles, the default store location, and one user per built-in role. */
export const seedBasics = async (prisma: PrismaClient) => {
  const roles: Record<string, { id: string; name: string }> = {};
  for (const name of BUILTIN_ROLES) {
    roles[name] = await prisma.role.create({ data: { name, isProtected: name === OWNER_ROLE } });
    if (name !== OWNER_ROLE) {
      // roles have exactly the permissions stored for them, as in production after Phase 1
      await prisma.rolePermission.createMany({
        data: (DEFAULT_ROLE_PERMISSIONS[name] ?? []).map((permission) => ({ roleId: roles[name].id, permission })),
      });
    }
  }
  const location = await prisma.location.create({ data: { code: "DEFAULT_STORE", name: "Main Store" } });
  const hash = await bcrypt.hash(PASSWORD, 4);
  const users: Record<string, { id: string; email: string }> = {};
  for (const name of BUILTIN_ROLES) {
    users[name] = await prisma.user.create({
      data: {
        email: `${name.toLowerCase()}@test.local`,
        passwordHash: hash,
        displayName: name,
        roleId: roles[name].id,
      },
    });
  }
  return { roles, users, location };
};

export const login = async (t: TestApp, email: string, password = PASSWORD) => {
  const res = await request(t.http()).post("/auth/login").send({ email, password });
  if (res.status !== 200) {
    throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.accessToken as string;
};

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

/** A product with opening stock recorded the way the app does it: batch + RECEIPT movement. */
export const createProduct = async (
  prisma: PrismaClient,
  locationId: string,
  opts: {
    name?: string;
    price?: number;
    cost?: number;
    stock?: number;
    expiry?: string | null;
    categoryId?: string;
  } = {},
) => {
  const category =
    opts.categoryId !== undefined
      ? { id: opts.categoryId }
      : await prisma.category.upsert({ where: { name: "Test" }, update: {}, create: { name: "Test" } });
  const product = await prisma.product.create({
    data: {
      name: opts.name ?? `Product ${Math.random().toString(36).slice(2, 8)}`,
      sku: `sku-${Math.random().toString(36).slice(2, 10)}`,
      categoryId: category.id,
      sellingPrice: opts.price ?? 100,
      costPrice: opts.cost ?? 60,
    },
  });
  const stock = new Prisma.Decimal(opts.stock ?? 0);
  const inventory = await prisma.inventoryItem.create({
    data: {
      productId: product.id,
      locationId,
      quantityOnHand: stock,
      averageCost: opts.cost ?? 60,
    },
  });
  if (stock.gt(0)) {
    await addBatch(prisma, inventory.id, product.id, stock, opts.expiry ?? null, opts.cost ?? 60, new Prisma.Decimal(0));
  }
  return { product, inventory };
};

/** Record an extra receipt (new batch) for stock that is already on hand. */
export const addBatch = async (
  prisma: PrismaClient,
  inventoryItemId: string,
  productId: string,
  qty: Prisma.Decimal,
  expiry: string | null,
  cost: number,
  before: Prisma.Decimal,
) => {
  const batch = await prisma.stockBatch.create({
    data: {
      productId,
      qtyReceived: qty,
      qtyRemaining: qty,
      unitCost: cost,
      expiryDate: expiry ? new Date(expiry) : null,
    },
  });
  await prisma.stockMovement.create({
    data: {
      inventoryItemId,
      stockBatchId: batch.id,
      type: MovementType.RECEIPT,
      qtyDelta: qty,
      unitCost: cost,
      beforeOnHand: before,
      afterOnHand: before.add(qty),
      refType: "STOCK_BATCH",
      refId: batch.id,
    },
  });
  return batch;
};

export const checkout = (
  t: TestApp,
  token: string,
  body: Record<string, unknown>,
  key: string = `key-${Math.random().toString(36).slice(2)}-${Date.now()}`,
) => request(t.http()).post("/sales/checkout").set(bearer(token)).set("Idempotency-Key", key).send(body);

export const close = async (t: TestApp | INestApplication) => {
  const app = "app" in t ? t.app : t;
  await app.close();
};

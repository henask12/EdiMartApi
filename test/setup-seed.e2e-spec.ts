import { Logger } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { PrismaModule } from "../src/prisma/prisma.module";
import { SetupModule } from "../src/setup/setup.module";
import { isSetupEnabled } from "../src/setup/setup.config";
import { reconcileStock } from "../src/inventory/reconciliation";
import { runSeed, SeedRefusedError } from "../src/seed/seed-runner";
import { PrismaService } from "../src/prisma/prisma.service";
import { TestApp, close, createTestApp, resetData, seedBasics, login, createProduct } from "./helpers";

describe("setup flag", () => {
  it("is off unless explicitly enabled (and on only in development by default)", () => {
    expect(isSetupEnabled({})).toBe(false);
    expect(isSetupEnabled({ NODE_ENV: "production" })).toBe(false);
    expect(isSetupEnabled({ NODE_ENV: "production", SETUP_ENABLED: "0" })).toBe(false);
    expect(isSetupEnabled({ NODE_ENV: "production", SETUP_ENABLED: "1" })).toBe(true);
    expect(isSetupEnabled({ SETUP_ENABLED: "true" })).toBe(true);
    expect(isSetupEnabled({ NODE_ENV: "development" })).toBe(true);
    expect(isSetupEnabled({ NODE_ENV: "development", SETUP_ENABLED: "false" })).toBe(false);
  });
});

describe("first-run seed and setup endpoints", () => {
  let setupApp: NestExpressApplication;
  let prisma: PrismaService;
  let t: TestApp;
  const logged: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [PrismaModule, SetupModule] }).compile();
    setupApp = moduleRef.createNestApplication<NestExpressApplication>();
    await setupApp.init();
    prisma = setupApp.get(PrismaService);
    t = await createTestApp();
    jest.spyOn(Logger.prototype, "warn").mockImplementation((message: unknown) => {
      logged.push(String(message));
    });
  });
  afterAll(async () => {
    jest.restoreAllMocks();
    await setupApp.close();
    await close(t);
  });
  beforeEach(async () => {
    logged.length = 0;
    await resetData(prisma);
    process.env.SETUP_SECRET = "setup-secret-for-tests";
    delete process.env.ADMIN_INITIAL_PASSWORD;
    delete process.env.SEED_DEMO_USERS;
  });

  const seed = (key = "setup-secret-for-tests") =>
    request(setupApp.getHttpServer()).post("/setup/seed").set("X-Setup-Key", key);

  it("rejects a wrong or missing setup key", async () => {
    expect((await seed("nope")).status).toBe(403);
    expect((await request(setupApp.getHttpServer()).post("/setup/seed")).status).toBe(403);
    expect(await prisma.user.count()).toBe(0);
  });

  it("seeds an empty database, never returns a password, and logs a generated one once", async () => {
    const res = await seed();
    expect(res.status).toBe(201);
    expect(JSON.stringify(res.body).toLowerCase()).not.toContain("password");
    expect(res.body.login).toBeUndefined();

    const line = logged.find((l) => l.includes("FIRST-RUN OWNER LOGIN"));
    expect(line).toBeDefined();
    const [, email, password] = /: (\S+) \/ (\S+)$/.exec(line!)!;
    expect(password.length).toBeGreaterThanOrEqual(12);
    expect(password).not.toMatch(/Owner123/);

    // The generated login works, and must be changed straight away.
    const owner = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(owner.mustChangePassword).toBe(true);
    const token = await login(t, email, password);
    const me = await request(t.http()).get("/auth/me").set({ Authorization: `Bearer ${token}` });
    expect(me.body.mustChangePassword).toBe(true);
    expect(me.body.role).toBe("OWNER");
  });

  it("uses ADMIN_INITIAL_PASSWORD when provided and does not log it", async () => {
    process.env.ADMIN_INITIAL_PASSWORD = "My-Chosen-Passw0rd";
    expect((await seed()).status).toBe(201);
    expect(logged.join("\n")).not.toContain("My-Chosen-Passw0rd");
    await login(t, "owner@edisims.local", "My-Chosen-Passw0rd");
  });

  it("refuses a too-short ADMIN_INITIAL_PASSWORD", async () => {
    process.env.ADMIN_INITIAL_PASSWORD = "short";
    const res = await seed();
    expect(res.status).toBe(500);
    expect(await prisma.user.count()).toBe(0);
  });

  it("creates demo cashier/staff only when asked, each with its own generated password", async () => {
    await seed();
    expect(await prisma.user.count()).toBe(1);

    await resetData(prisma);
    process.env.SEED_DEMO_USERS = "1";
    logged.length = 0;
    await seed();
    expect(await prisma.user.count()).toBe(3);
    const demo = logged.filter((l) => l.startsWith("DEMO LOGIN"));
    expect(demo).toHaveLength(2);
    const passwords = demo.map((l) => l.split(" / ")[1]);
    expect(new Set(passwords).size).toBe(2);
    expect(passwords.join(" ")).not.toMatch(/Cashier123|Staff123/);
    expect((await prisma.user.findMany()).every((u) => u.mustChangePassword)).toBe(true);
  });

  it("refuses to run on a database that already has data - live stock is never reset", async () => {
    await seed();
    const product = await prisma.product.findFirstOrThrow();
    await prisma.inventoryItem.updateMany({ where: { productId: product.id }, data: { quantityOnHand: 777 } });

    const again = await seed();
    expect(again.status).toBe(409);
    const inv = await prisma.inventoryItem.findFirstOrThrow({ where: { productId: product.id } });
    expect(inv.quantityOnHand.toString()).toBe("777");
    await expect(runSeed(prisma)).rejects.toBeInstanceOf(SeedRefusedError);
  });

  it("also refuses when only sales exist (no users)", async () => {
    const basics = await seedBasics(prisma);
    await prisma.user.deleteMany({ where: { id: { not: basics.users.OWNER.id } } });
    await prisma.user.delete({ where: { id: basics.users.OWNER.id } }).catch(() => undefined);
    const { product } = await createProduct(prisma, basics.location.id, { stock: 1 });
    expect(product).toBeDefined();
    // movements from the opening stock count as data
    await expect(runSeed(prisma)).rejects.toBeInstanceOf(SeedRefusedError);
  });

  it("writes opening stock through the ledger so the reconciliation is clean from day one", async () => {
    await seed();
    expect(await prisma.product.count()).toBeGreaterThan(5);
    const report = await reconcileStock(prisma);
    expect(report.totals.inventoryRows).toBeGreaterThan(5);
    expect(report.findings).toEqual([]);
    expect(await prisma.sale.count()).toBe(0);
  });

  it("status reports readiness", async () => {
    const before = await request(setupApp.getHttpServer()).get("/setup/status");
    expect(before.body.ready).toBe(false);
    await seed();
    const after = await request(setupApp.getHttpServer()).get("/setup/status");
    expect(after.body.ready).toBe(true);
  });
});

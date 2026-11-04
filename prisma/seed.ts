/**
 * `npm run db:seed` — first-run data for an empty database. See src/seed/seed-runner.ts for
 * what it creates and the environment variables it reads (ADMIN_EMAIL, ADMIN_INITIAL_PASSWORD,
 * SEED_DEMO_USERS, SEED_CATALOG).
 */
import { PrismaClient } from "@prisma/client";
import { runSeed } from "../src/seed/seed-runner";

const prisma = new PrismaClient();

runSeed(prisma, { log: (message) => console.log(message) })
  .then((summary) => console.log("Seed complete:", summary))
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

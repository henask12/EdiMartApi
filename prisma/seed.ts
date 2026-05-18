import { PrismaClient } from "@prisma/client";
import { runSeed } from "../src/seed/seed-runner";

const prisma = new PrismaClient();

runSeed(prisma)
  .then((summary) => {
    console.log("Seed complete.", summary);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

const { execSync } = require("child_process");

const resolveDatabaseUrl = () => {
  const url =
    process.env.DATABASE_URL?.trim() ||
    process.env.DATABASE_PRIVATE_URL?.trim() ||
    process.env.POSTGRES_URL?.trim() ||
    process.env.DATABASE_PUBLIC_URL?.trim();
  if (url && !process.env.DATABASE_URL) {
    process.env.DATABASE_URL = url;
  }
  return url;
};

const run = (cmd) => {
  execSync(cmd, { stdio: "inherit" });
};

const dbUrl = resolveDatabaseUrl();
const jwtSecret = process.env.JWT_SECRET?.trim();

if (!dbUrl) {
  console.error(
    "Missing DATABASE_URL. In Railway → EdiMartApi → Variables, add a reference from Postgres:\n" +
      "  DATABASE_URL = ${{Postgres.DATABASE_URL}}",
  );
  process.exit(1);
}

if (!jwtSecret) {
  console.error(
    "Missing JWT_SECRET. In Railway → EdiMartApi → Variables, add JWT_SECRET (48+ random characters).",
  );
  process.exit(1);
}

if (process.env.RAILWAY_RESET_DB === "1") {
  console.log("RAILWAY_RESET_DB=1 — wiping public schema...");
  run("npx prisma db execute --file scripts/reset-public-schema.sql --schema prisma/schema.prisma");
}

const syncSchema = () => {
  const preferPush =
    process.env.PRISMA_DB_PUSH === "1" || process.env.RAILWAY_ENVIRONMENT != null;

  if (preferPush) {
    console.log("Syncing database schema (prisma db push)...");
    run("npx prisma db push --skip-generate");
    return;
  }

  try {
    console.log("Applying database migrations...");
    run("npx prisma migrate deploy");
  } catch (err) {
    console.warn("migrate deploy failed; falling back to prisma db push...");
    console.warn(err.message ?? err);
    run("npx prisma db push --skip-generate");
  }
};

try {
  syncSchema();
} catch (err) {
  console.error("Database sync failed:", err.message ?? err);
  console.error(
    "If migrations were stuck (P3009), set RAILWAY_RESET_DB=1 on EdiMartApi, redeploy once, then remove it.",
  );
  process.exit(1);
}

console.log("Starting API...");
run("node dist/main.js");

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

const dbUrl = resolveDatabaseUrl();
const jwtSecret = process.env.JWT_SECRET?.trim();

if (!dbUrl) {
  console.error(
    "Missing DATABASE_URL. In Railway → EdiMartApi → Variables, add a reference from Postgres:\n" +
      "  DATABASE_URL = ${{Postgres.DATABASE_URL}}\n" +
      "Or set DATABASE_PRIVATE_URL from the Postgres service.",
  );
  process.exit(1);
}

if (!jwtSecret) {
  console.error(
    "Missing JWT_SECRET. In Railway → EdiMartApi → Variables, add JWT_SECRET (48+ random characters).",
  );
  process.exit(1);
}

try {
  console.log("Applying database migrations...");
  execSync("npx prisma migrate deploy", { stdio: "inherit" });
} catch (err) {
  console.error("prisma migrate deploy failed:", err.message ?? err);
  process.exit(1);
}

console.log("Starting API...");
execSync("node dist/main.js", { stdio: "inherit" });

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const run = (cmd) => execSync(cmd, { stdio: "inherit" });

const distMain = path.join(process.cwd(), "dist", "main.js");
if (!fs.existsSync(distMain)) {
  console.error(
    `Missing ${distMain}. Set Render Build Command to: npm install --include=dev && npm run build`,
  );
  console.error("Root Directory must be the repo root (leave blank), not src.");
  process.exit(1);
}

const resolveDatabaseUrl = () => {
  const url =
    process.env.DATABASE_URL?.trim() ||
    process.env.DATABASE_PRIVATE_URL?.trim() ||
    process.env.POSTGRES_URL?.trim();
  if (url && !process.env.DATABASE_URL) {
    process.env.DATABASE_URL = url;
  }
  return url;
};

if (!resolveDatabaseUrl()) {
  console.error("Missing DATABASE_URL on Render.");
  process.exit(1);
}
if (!process.env.JWT_SECRET?.trim()) {
  console.error("Missing JWT_SECRET on Render.");
  process.exit(1);
}

try {
  console.log("Syncing database schema (prisma db push)...");
  run("npx prisma db push --skip-generate");
} catch (err) {
  console.error("prisma db push failed:", err.message ?? err);
  process.exit(1);
}

console.log("Starting API...");
run("node dist/main.js");

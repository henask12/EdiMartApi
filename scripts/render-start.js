const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

/** Repo root (parent of /scripts) — works even if Render cwd is /src */
const repoRoot = path.resolve(__dirname, "..");

const run = (cmd) => {
  execSync(cmd, { stdio: "inherit", cwd: repoRoot, env: process.env });
};

const findDistMain = () => {
  const candidates = [
    path.join(repoRoot, "dist", "main.js"),
    path.join(process.cwd(), "dist", "main.js"),
    path.join(process.cwd(), "..", "dist", "main.js"),
  ];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
};

let distMain = findDistMain();

if (!distMain) {
  console.log("dist/main.js not found — running build in repo root...");
  try {
    run("npm run build");
  } catch (err) {
    console.error("Build failed:", err.message ?? err);
    console.error(
      "On Render set: Root Directory = (empty), Build Command = npm install --include=dev && npm run build",
    );
    process.exit(1);
  }
  distMain = findDistMain();
}

if (!distMain) {
  console.error(`Build finished but dist/main.js is still missing under ${repoRoot}`);
  process.exit(1);
}

console.log(`Using ${distMain}`);

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
execSync(`node "${distMain}"`, { stdio: "inherit", cwd: repoRoot, env: process.env });

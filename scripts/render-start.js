const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

/** Walk up from this file until we find the real API root (package.json + nest-cli + prisma). */
const findRepoRoot = () => {
  let dir = path.resolve(__dirname, "..");
  for (let i = 0; i < 6; i += 1) {
    const hasPkg = fs.existsSync(path.join(dir, "package.json"));
    const hasNest = fs.existsSync(path.join(dir, "nest-cli.json"));
    const hasPrisma = fs.existsSync(path.join(dir, "prisma", "schema.prisma"));
    if (hasPkg && hasNest && hasPrisma) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  throw new Error(
    "Could not find EdiMart API root. On Render → Settings → set Root Directory to EMPTY (not src), then redeploy.",
  );
};

const repoRoot = findRepoRoot();

const run = (cmd) => {
  console.log(`> (${repoRoot}) ${cmd}`);
  execSync(cmd, { stdio: "inherit", cwd: repoRoot, env: process.env });
};

const findDistMain = () => {
  const candidates = [
    path.join(repoRoot, "dist", "main.js"),
    path.join(process.cwd(), "dist", "main.js"),
  ];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
};

let distMain = findDistMain();

if (!distMain) {
  console.log("dist/main.js missing — installing and building...");
  try {
    run("npm install --include=dev");
    run("npm run build");
  } catch (err) {
    console.error("Build failed:", err.message ?? err);
    console.error(
      "Render Build Command should be: npm install --include=dev && npm run build",
    );
    console.error("Render Root Directory must be blank (repository root).");
    process.exit(1);
  }
  distMain = findDistMain();
}

if (!distMain) {
  console.error(`Build completed but dist/main.js not found. Repo root: ${repoRoot}`);
  console.error("Listing repo root:", fs.readdirSync(repoRoot).join(", "));
  const distDir = path.join(repoRoot, "dist");
  if (fs.existsSync(distDir)) {
    console.error("dist/ contents:", fs.readdirSync(distDir).join(", "));
  }
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

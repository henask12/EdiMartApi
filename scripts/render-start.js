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
const ROLE_STRING_MIGRATION = "20250520120000_role_name_string";

const run = (cmd) => {
  console.log(`> (${repoRoot}) ${cmd}`);
  execSync(cmd, { stdio: "inherit", cwd: repoRoot, env: process.env });
};

const runCapture = (cmd) => {
  try {
    execSync(cmd, { cwd: repoRoot, env: process.env, encoding: "utf8" });
    return { ok: true, output: "" };
  } catch (err) {
    const output = [err.message, err.stdout, err.stderr].filter(Boolean).join("\n");
    return { ok: false, output };
  }
};

const listMigrations = () => {
  const dir = path.join(repoRoot, "prisma", "migrations");
  return fs
    .readdirSync(dir)
    .filter((name) => {
      const full = path.join(dir, name);
      return fs.statSync(full).isDirectory() && name !== "migration_lock.toml";
    })
    .sort();
};

/** Migration resolve succeeded or DB already has this migration applied (P3008). */
const isMigrationAlreadyApplied = (output) =>
  output.includes("P3008") ||
  output.includes("already recorded as applied") ||
  output.includes("already recorded") ||
  output.includes("already applied");

/** Parse failed migration names from Prisma error output (P3009). */
const extractFailedMigrations = (output) => {
  const names = new Set();
  for (const match of output.matchAll(/`(\d{14}_[^`]+)` migration/g)) {
    names.add(match[1]);
  }
  return [...names];
};

/** Clear failed rows in _prisma_migrations so deploy can continue. */
const clearFailedMigrations = (output) => {
  const failed = extractFailedMigrations(output);
  if (failed.length === 0 && output.includes("P3009")) {
    failed.push("20250516000000_init");
  }
  for (const name of failed) {
    console.log(`Marking failed migration as rolled back: ${name}`);
    const result = runCapture(`npx prisma migrate resolve --rolled-back "${name}"`);
    if (
      !result.ok &&
      !result.output.includes("already") &&
      !isMigrationAlreadyApplied(result.output)
    ) {
      console.warn(`Could not roll back ${name}:`, result.output);
    }
  }
};

/**
 * DB already has tables (from db push) or a failed init left migration history inconsistent.
 * Mark every migration except role_name_string as applied without re-running SQL.
 */
const baselineExistingSchema = () => {
  const migrations = listMigrations();
  for (const name of migrations) {
    if (name === ROLE_STRING_MIGRATION) {
      continue;
    }
    console.log(`Marking migration as applied: ${name}`);
    const result = runCapture(`npx prisma migrate resolve --applied "${name}"`);
    if (result.ok) {
      continue;
    }
    if (isMigrationAlreadyApplied(result.output)) {
      console.log(`Migration ${name} is already applied, skipping.`);
      continue;
    }
    console.warn(`Could not resolve ${name}:`, result.output);
  }
};

const recoverMigrationHistory = (output) => {
  if (output.includes("P3009")) {
    console.log("Found failed migration record(s) (P3009). Clearing…");
    clearFailedMigrations(output);
  }
  console.log("Baselining schema that already exists on this database…");
  baselineExistingSchema();
};

const applyMigrations = () => {
  console.log("Applying database migrations (prisma migrate deploy)...");
  const first = runCapture("npx prisma migrate deploy");
  if (first.ok) {
    return;
  }

  const needsRecovery =
    first.output.includes("P3005") ||
    first.output.includes("P3009") ||
    first.output.includes("database schema is not empty") ||
    first.output.includes("schema is not empty") ||
    first.output.includes("failed migrations");

  if (needsRecovery) {
    console.log("Recovering migration history, then deploying pending migrations…");
    recoverMigrationHistory(first.output);
    const second = runCapture("npx prisma migrate deploy");
    if (second.ok) {
      return;
    }
    console.error("prisma migrate deploy failed after recovery:\n", second.output);
    process.exit(1);
  }

  console.error("prisma migrate deploy failed:\n", first.output);
  process.exit(1);
};

const findDistMain = () => {
  const candidates = [
    path.join(repoRoot, "dist", "main.js"),
    path.join(repoRoot, "dist", "src", "main.js"),
    path.join(process.cwd(), "dist", "main.js"),
    path.join(process.cwd(), "dist", "src", "main.js"),
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
  console.error(`Build completed but no runnable main.js was found. Repo root: ${repoRoot}`);
  console.error("Listing repo root:", fs.readdirSync(repoRoot).join(", "));
  const distDir = path.join(repoRoot, "dist");
  if (fs.existsSync(distDir)) {
    console.error("dist/ contents:", fs.readdirSync(distDir).join(", "));
    const distSrcDir = path.join(distDir, "src");
    if (fs.existsSync(distSrcDir)) {
      console.error("dist/src contents:", fs.readdirSync(distSrcDir).join(", "));
    }
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
  applyMigrations();
} catch (err) {
  console.error("Database migration failed:", err.message ?? err);
  process.exit(1);
}

console.log("Starting API...");
execSync(`node "${distMain}"`, { stdio: "inherit", cwd: repoRoot, env: process.env });

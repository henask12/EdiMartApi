#!/usr/bin/env node
/**
 * Cross-platform wrapper around pg_dump + optional S3 upload.
 * Prefer scripts/backup-pg.sh on Linux/macOS cron; this .mjs works on Windows too
 * when `pg_dump` and (optionally) AWS CLI are on PATH.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
const outDir = process.env.BACKUP_DIR || "./backups";
mkdirSync(outDir, { recursive: true });
const file = join(outDir, `edimart-${stamp}.dump`);

console.log(`Dumping database to ${file}`);
const dump = spawnSync(
  "pg_dump",
  ["--format=custom", "--no-owner", "--no-acl", `--dbname=${databaseUrl}`, `--file=${file}`],
  { stdio: "inherit", shell: process.platform === "win32" },
);
if (dump.status !== 0) {
  process.exit(dump.status ?? 1);
}
const mb = (statSync(file).size / (1024 * 1024)).toFixed(2);
console.log(`Local dump ready: ${file} (${mb} MiB)`);

const bucket = process.env.S3_BUCKET?.trim();
const accessKey = process.env.S3_ACCESS_KEY_ID?.trim();
const secretKey = process.env.S3_SECRET_ACCESS_KEY?.trim();
if (bucket && accessKey && secretKey) {
  const prefix = process.env.BACKUP_S3_PREFIX || "edimart/backups";
  const key = `${prefix}/edimart-${stamp}.dump`;
  const endpoint = process.env.S3_ENDPOINT?.trim();
  const args = ["s3", "cp", file, `s3://${bucket}/${key}`];
  if (endpoint) {
    args.push("--endpoint-url", endpoint);
  }
  const env = {
    ...process.env,
    AWS_ACCESS_KEY_ID: accessKey,
    AWS_SECRET_ACCESS_KEY: secretKey,
    AWS_DEFAULT_REGION: process.env.S3_REGION || "auto",
  };
  console.log(`Uploading s3://${bucket}/${key}`);
  const up = spawnSync("aws", args, { stdio: "inherit", env, shell: process.platform === "win32" });
  if (up.status !== 0) {
    process.exit(up.status ?? 1);
  }
}

if (!existsSync(file)) {
  console.error("Dump file missing after pg_dump");
  process.exit(1);
}
console.log("Done.");

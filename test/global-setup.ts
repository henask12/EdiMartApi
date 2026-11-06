import { execSync } from "child_process";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import EmbeddedPostgres from "embedded-postgres";
import { TEST_DB_PORT } from "./env";

export default async function globalSetup() {
  const databaseDir = mkdtempSync(join(tmpdir(), "edimart-pg-"));
  const pg = new EmbeddedPostgres({
    databaseDir,
    user: "postgres",
    password: "postgres",
    port: TEST_DB_PORT,
    persistent: false,
    onLog: () => undefined,
    onError: () => undefined,
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("edimart_test");
  (globalThis as { __EDIMART_PG__?: EmbeddedPostgres }).__EDIMART_PG__ = pg;

  // Apply the real migration history to a fresh database, exactly as production would.
  execSync("node node_modules/prisma/build/index.js migrate deploy", {
    stdio: "inherit",
    env: {
      ...process.env,
      DATABASE_URL: `postgresql://postgres:postgres@127.0.0.1:${TEST_DB_PORT}/edimart_test`,
    },
  });
}

import type EmbeddedPostgres from "embedded-postgres";

export default async function globalTeardown() {
  const pg = (globalThis as { __EDIMART_PG__?: EmbeddedPostgres }).__EDIMART_PG__;
  try {
    await pg?.stop();
  } catch {
    // Windows can keep the temp data dir locked for a moment after shutdown; it is disposable.
  }
}

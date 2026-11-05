# Database backups and restore

EdiMart stores all money and stock state in Postgres. Take a custom-format
`pg_dump` at least daily and keep copies off the app host.

## Take a backup

Requires `pg_dump` on PATH (same major version as the server is ideal).

```bash
# Linux / macOS
export DATABASE_URL='postgresql://…'
# optional object storage (Cloudflare R2 / S3 / Supabase)
# export S3_BUCKET=… S3_ENDPOINT=… S3_REGION=auto
# export S3_ACCESS_KEY_ID=… S3_SECRET_ACCESS_KEY=…
# export BACKUP_RETENTION_DAYS=14   # used by backup-pg.sh only
bash scripts/backup-pg.sh
```

```bash
# Windows / cross-platform Node wrapper
set DATABASE_URL=postgresql://…
node scripts/backup-pg.mjs
```

Local files land in `./backups/edimart-<UTC-stamp>.dump` (or `BACKUP_DIR`).
When S3 env vars are set, the dump is also uploaded under
`edimart/backups/` (override with `BACKUP_S3_PREFIX`).

Suggested cron (Render cron job, GitHub Actions schedule, or host crontab):

```
15 2 * * * cd /app && bash scripts/backup-pg.sh >> /var/log/edimart-backup.log 2>&1
```

## Restore (runbook)

1. **Stop writers.** Pause the API (and any workers) so nothing mutates the DB
   mid-restore.
2. **Provision a target database.** Prefer a *new* empty database, restore
   into it, then cut over `DATABASE_URL`. Restoring over a live shop DB is
   possible but risky.
3. **Restore the dump:**

   ```bash
   # Create empty DB first if needed, then:
   pg_restore --clean --if-exists --no-owner --no-acl \
     --dbname="$DATABASE_URL" \
     backups/edimart-YYYYMMDDTHHMMSSZ.dump
   ```

   If `--clean` complains about missing objects on a brand-new DB, drop
   `--clean --if-exists` and restore into the empty database once.
4. **Apply migrations if the dump is older than current code:**

   ```bash
   npm run db:migrate
   ```

   Additive migrations are safe; never invent destructive SQL by hand.
5. **Smoke-check:** `GET /health`, login as owner, open a known sale and a
   product with stock. Optionally `npm run reconcile` (read-only) and confirm
   no unexpected drift.
6. **Point the app** at the restored `DATABASE_URL` and restart.

## Retention

Default remote prune in `backup-pg.sh` is **14 days** (`BACKUP_RETENTION_DAYS`).
Keep at least one monthly copy offline for longer if the shop volume justifies it.

## Notes

- Render free tier has **no durable disk**; do not rely on local `./backups`
  there. Always upload to object storage.
- Never commit dump files or paste `DATABASE_URL` into tickets.
- Test a restore on a throwaway database at least once per quarter.

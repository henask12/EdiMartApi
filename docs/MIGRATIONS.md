# Database migrations: what was found and how to fix it (Phase 0, issue 11)

**Nothing in this document has been run against production.** It needs the owner's approval
(see "Decision needed" at the bottom).

## What was found

1. **The migration files did not match `schema.prisma`.** A database built *only* from
   `prisma migrate deploy` was missing the `Product.originCountry` column that the application
   writes on every product create, and `Product.costPrice` had no default. Production was
   evidently built partly with `prisma db push`, which hides this.
   *Fixed:* migration `20251103000100_schema_catchup` adds the column, the default, the corrected
   `Product -> Category` foreign key and the expiry index. Every statement is idempotent
   (`IF NOT EXISTS`), so it is a no-op on a database that already has them.
2. **Early migrations created tables/columns the schema no longer has**: `ProductImage`,
   `ProductVariant`, `SaleLine.variantId` and `Product.brand / dimensionsJson / taxRate /
   unitOfMeasure / weightGrams`. A database built from migrations carries these leftovers; a
   `db push` database does not. They are harmless but they are drift. **They are not dropped**
   (ground rule: no drops without approval). `test/smoke.e2e-spec.ts` lists them explicitly and
   fails if any *other* drift appears.
3. **`scripts/render-start.js` rewrote migration history at boot.** When `migrate deploy` failed
   it marked migrations as applied without running them. With new migrations in the repo that
   is dangerous (they would be skipped), so the baseline list is now frozen at
   `20250523120000_sale_line_unit_cost`; anything newer always really runs. The script is
   otherwise unchanged until the history is fixed.
4. **`scripts/railway-start.js` uses `prisma db push`** on Railway. `db push` cannot create the
   two non-negative stock `CHECK` constraints from migration `20251103000000_phase0_foundations`.
   If you deploy on Railway, run that migration's last two `ALTER TABLE` statements by hand, or
   switch Railway to `migrate deploy` as well.

The CI-style check for (1) and (2) runs on every test run: a fresh database is built from the
migrations and diffed against `schema.prisma`.

## Proposed one-time repair (needs approval)

Do this on a **copy** first.

```bash
# 0. Back up, then restore the dump into a scratch database and point DATABASE_URL at the scratch copy
pg_dump --format=custom --file=edimart-before.dump "$PROD_DATABASE_URL"
createdb edimart_copy && pg_restore --dbname=edimart_copy edimart-before.dump
export DATABASE_URL=postgresql://.../edimart_copy

# 1. See the state
npm run db:status

# 2. See exactly what differs from schema.prisma (expect: the Phase 0 additions, plus - if the DB
#    came from migrations - the legacy leftovers listed above)
node node_modules/prisma/build/index.js migrate diff \
  --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script

# 3. If the database has no migration history (error P3005), tell Prisma the legacy migrations
#    are already reflected in the schema. Only these eight, never the two newer ones:
for m in 20250516000000_init 20250516120000_small_mart_simplify 20250517100000_category_first_mart \
         20250518120000_feature_expansion 20250519120000_role_permissions \
         20250520120000_role_name_string 20250522120000_product_expiry \
         20250523120000_sale_line_unit_cost; do
  node node_modules/prisma/build/index.js migrate resolve --applied "$m"
done

# 4. Apply what is really new (Phase 0 foundations + schema catch-up)
node node_modules/prisma/build/index.js migrate deploy

# 5. Must report "Database schema is up to date!"
npm run db:status

# 6. Check stock against the ledger (read-only)
npm run reconcile
```

Step 3 is a judgement call per database: confirm with the diff in step 2 that each legacy
migration's effect really is present (for example `Role.name` is text, not an enum) before
marking it applied.

When step 5 is clean on the copy, repeat on production in a quiet period, then:

1. Set the Render **Start Command** to `npm run start:prod` (plain `prisma migrate deploy` then
   `node dist/main.js`).
2. Delete the repair code in `scripts/render-start.js` (or the whole file).

## After the Phase 0 migrations

`InventoryItem_quantityOnHand_nonneg` and `StockBatch_qtyRemaining_nonneg` are created
`NOT VALID`: they protect every new or changed row, and do not fail the migration if past drift
left a negative row. Once `npm run reconcile` shows no negative rows:

```sql
ALTER TABLE "InventoryItem" VALIDATE CONSTRAINT "InventoryItem_quantityOnHand_nonneg";
ALTER TABLE "StockBatch"    VALIDATE CONSTRAINT "StockBatch_qtyRemaining_nonneg";
```

## Decision needed

- Approve the repair above (and say whether production was built by `db push`, so step 3 applies).
- Say whether the legacy tables/columns in finding 2 may be dropped (a separate, explicit
  migration), or should stay.

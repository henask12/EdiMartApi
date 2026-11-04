# Changelog

## Phase 0 - correct and safe

### Fixed
- **Checkout race.** Stock is now checked and deducted inside one transaction that first locks the
  affected stock rows; ten parallel sales of the last unit produce exactly one sale and nine
  `409` answers naming the product. Two cart lines for the same product can no longer oversell.
- **Idempotent checkout.** `POST /sales/checkout` requires an `Idempotency-Key` header. Repeating
  a request with the same key and body returns the original sale (`replayed: true`) instead of
  selling twice; the same key with a different body is refused.
- **Sale numbers.** `SALE-YYYYMMDD-NNNN` now comes from a per-day counter row incremented in the
  checkout transaction, with the day taken in Africa/Addis_Ababa time. The first sale of the
  switch-over day continues after any number the old scheme already issued.
- **Payment method.** Checkout records the method (cash, Telebirr, CBE Birr, M-Pesa, bank transfer,
  card) and an optional transaction reference; it used to always store `CASH`.
- **Batches follow sales.** Sales and negative adjustments take stock from the batch that expires
  first and reduce `StockBatch.qtyRemaining`, so expiry screens and alerts no longer overstate stock.
- **Lost updates.** Receiving, adjusting and returning stock lock the stock row, so concurrent
  receipts of the same product no longer overwrite each other.
- **Reservations expire.** A job every 15 minutes marks due reservations `EXPIRED` and writes a
  `RELEASE_RESERVE` movement; an expired reservation also stops counting as reserved immediately.
  Reserving now checks availability under the same lock (two people can no longer reserve the last
  unit), and rejects an expiry that is invalid or in the past.
- **One receive endpoint.** `POST /inventory/receive` is removed; `POST /stock/receive` (which the
  web app already used) accepts `expiryDate`.
- **Reads need permissions.** Product list/detail/export, categories, product types, stock
  history, batches, movements and the reservation list now require a permission. Deactivating a
  product requires `PRODUCTS_DEACTIVATE` (it used to need only `PRODUCTS_EDIT`).
- **Deactivated users lose access immediately**, not when their token expires.
- **Sessions.** `SESSION_TTL_HOURS` (default 8) drives the JWT; the API returns `expiresInSeconds`
  and the web app uses it for the cookie. `JWT_EXPIRES_IN` is no longer read.
- **Business time zone.** Report periods, date filters and the daily expiry e-mail use
  Africa/Addis_Ababa instead of the server's zone.
- **Spreadsheet formula injection.** CSV/Excel cells that start with `= + - @` are neutralised.
- **Alert e-mail failures** no longer turn a committed sale into an error.
- `npm run db:seed` was broken (imported names that no longer exist); it now works.

### Security
- No default passwords anywhere. The seed uses `ADMIN_INITIAL_PASSWORD` or generates one and
  prints it once to the server log; the old fixed logins (`Owner123!` etc.) and the pre-filled
  login form are gone. Seeded, admin-created and admin-reset accounts must change their password
  on first sign-in (`User.mustChangePassword`, enforced by the API).
- The seed refuses to run on a database that already has users, sales or stock movements (it used
  to reset live stock and demo passwords on every run).
- `/setup/*` and `AUTO_SEED` exist only when `SETUP_ENABLED` is on (404 otherwise); the seed
  response never contains credentials.
- `helmet`, CORS limited to `WEB_ORIGIN`, per-account login rate limit (`LOGIN_RATE_LIMIT`,
  default 8 per 15 min), `/health` checks the database.
- Uploads: content-sniffed (JPEG/PNG/WebP/GIF only). Payment proofs are private and served through
  short-lived signed links; product photos stay public.

### Added
- `StorageService` with a local driver and an S3-compatible driver (Cloudflare R2, AWS S3,
  Supabase Storage) and `npm run uploads:migrate` to move existing files.
- `npm run reconcile`: read-only report comparing stored stock with the movement ledger.
- Test suite (Jest + a real embedded PostgreSQL): `npm test`.
- `docs/MIGRATIONS.md`: migration-history findings and the proposed one-time repair.

### Database (additive only)
- `20251103000000_phase0_foundations`: `User.mustChangePassword`; payment methods `TELEBIRR`,
  `CBE_BIRR`, `MPESA`, `BANK_TRANSFER`; `PaymentAllocation.reference`; `DocumentCounter`;
  `IdempotencyKey`; reservation expiry index; non-negative `CHECK` constraints on stock
  (`NOT VALID`, see `docs/MIGRATIONS.md`).
- `20251103000100_schema_catchup`: idempotent catch-up so migrations match `schema.prisma`.

### Changed
- `prisma/catalog-seed-data.ts` moved to `src/seed/` so the build outputs `dist/main.js`
  (the start scripts previously had to search for it).
- `scripts/render-start.js` can no longer baseline migrations newer than
  `20250523120000_sale_line_unit_cost`.

### Not done in this phase
- Fixing the production migration history (needs approval; see `docs/MIGRATIONS.md`).
- Dropping the legacy `ProductImage` / `ProductVariant` tables and columns.
- `@Roles` is still used on write endpoints; Phase 1 replaces it with permissions.

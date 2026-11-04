# Changelog

## Phase 5 — Shifts and cash control (API)

### Added
- **Registers**: `GET /registers` (any signed-in user), `POST/PATCH /registers`
  (`SETTINGS_MANAGE`). Default till `REGISTER-1` from migration + seed upsert.
- **Shifts**: open / list / current / get; cash-in, cash-out, no-sale (log only, no
  hardware kick); blind close with counted vs expected variance; X and Z reports
  (printable JSON). Numbering `SHF-YYYYMMDD-NNNN` via `DocumentCounter` scope `SHIFT`.
- **Settings**: `shifts.requireOpenShift` (default `"true"`),
  `shifts.varianceApprovalThreshold` (default `"100"` Birr),
  `shifts.eodEmailEnabled` (default `"true"`).
- **Checkout gate**: when require-open-shift is on, checkout needs an open shift for
  the actor (optional `x-register-id` header); sets `Sale.shiftId`. Proxy allowlist
  includes `x-register-id`.
- **Approvals**: `SHIFT_VARIANCE_OVER_LIMIT` → `SHIFT_VIEW_ALL`; no-sale uses existing
  `NO_SALE_DRAWER_OPEN` → `CASH_DRAWER_OPEN`.
- **EOD**: best-effort Resend email on close (`NotificationType.SHIFT_EOD`); Telegram
  stub logs only.
- Permissions **active**: `CASH_DRAWER_OPEN`, `SHIFT_MANAGE`, `SHIFT_VIEW_ALL`.
  Cashier role defaults gain `SHIFT_MANAGE` (not drawer open / view-all).

### Database (additive only)
- Migration `20261104160000_phase5_shifts`: `Register`, `Shift`, `CashMovement`,
  `ShiftCount`, `Sale.shiftId`, enums, default `REGISTER-1`, `NotificationType.SHIFT_EOD`.

## Phase 4 — POS selling core (API)

### Added
- **POS store settings** (`pos.*` keys on `GET/PATCH /settings/store`): VAT rate (default 15%),
  prices-include-VAT, discount limit %, return window days, receipt shop fields, scanner beep,
  favourites JSON, payment method config, cash denominations, label-as-tax-invoice.
- **FiscalService** no-op driver (`registerSale` → `{ status: 'NONE' }`); called after checkout
  without blocking the sale. Sale fiscal columns reserved for a real driver later.
- **Checkout expansions** (backward compatible): line `unitPrice` override, line/cart discounts
  (fixed or %), split `payments[]` with cash tendered/change, VAT-inclusive tax math by
  `Product.taxCategory`, discount/price-override permission + `X-Approval-Token` approvals
  (`PRICE_OVERRIDE`, `DISCOUNT_OVER_LIMIT`).
- **Parked carts**: `GET /sales/parked`, `POST /sales/park`, `DELETE /sales/parked/:id`,
  `POST /sales/parked/:id/resume` — expire at end of business day (Africa/Addis_Ababa).
- **Void**: `POST /sales/:id/void` (`SALES_VOID`) — restocks via RETURN movements (reversing
  `SaleLineBatch` where possible), CreditNote kind VOID, status VOIDED. Prior business day needs
  `SALE_VOID` approval.
- **Return**: `POST /sales/:id/return` (`SALES_REFUND`) — partial/full returns with
  RESTOCK|DAMAGED|NEEDS_INSPECTION, window from settings (`REFUND_OUTSIDE_WINDOW` approval),
  CreditNote kind RETURN, status PARTIALLY_REFUNDED / REFUNDED.
- **Receipts**: `GET /sales/:id/receipt` (structured JSON) and public
  `GET /sales/receipt/:token` (HMAC-signed, `FILE_URL_SECRET` / `JWT_SECRET`).
- List filters: `cashierUserId`, `paymentMethod`, `status`.
- Permissions now **active**: `SALES_VOID`, `SALES_REFUND`, `DISCOUNT_APPLY`,
  `DISCOUNT_ABOVE_LIMIT`, `PRICE_OVERRIDE`.

### Database (additive only)
- Migration `20261104140000_phase4_pos`: Sale notes/fiscal/void fields; SaleLine override fields;
  PaymentAllocation tender/change/proof/cashier; `CreditNote` + `CreditNoteLine`; `ParkedCart`;
  `CreditCondition` enum.

### Defaults (owner-approved for this phase)
- VAT 15%, prices include VAT; walk-in only (no Customer); payment methods = existing enum only
  (no store credit); parked carts expire end of business day.

## Phase 3 — Inventory core

### Follow-ups (same phase)
- Transfer cancel; quarantine move; replenishment suggestions; nightly snapshot+reconcile cron
  (00:05 Africa/Addis_Ababa); bulk CSV import preview/commit (`/imports/products/*`).
- Product create/update: Amharic name, brand, barcode, trackBatches, min/max.
- Client: expiry quarantine/write-off, stock-count detail (blind entry), inventory replenishment
  list, `/products/import`.

### Added (new endpoints)
- **Locations** CRUD: `GET /locations` (any authenticated), `GET /locations/:id`,
  `POST /locations` (`LOCATIONS_MANAGE`), `PATCH /locations/:id` (`LOCATIONS_MANAGE`).
  Default shop = "Shop floor" (`DEFAULT_STORE`), plus sellable `BACK_STORE` and non-sellable
  `QUARANTINE` (same storeCode so a second store can be added later).
- **Transfers**: `GET /transfers`, `GET /transfers/:id`, `POST /transfers` (draft),
  `POST /transfers/:id/send`, `POST /transfers/:id/receive`, `POST /transfers/:id/cancel` —
  all `STOCK_TRANSFER`. Draft → sent (deducts source, writes TRANSFER movements) → received
  (adds destination). Numbered `TRF-YYYYMMDD-NNNN` via `DocumentCounter`.
- **Stock counts**: `GET /stock-counts`, `GET /stock-counts/:id`, `POST /stock-counts` (draft),
  `POST /stock-counts/:id/start` (snapshots system qty), `POST /stock-counts/:id/lines` (record
  counted qty), `POST /stock-counts/:id/post` (`STOCK_COUNT_APPROVE`) — writes COUNT movements.
  Numbered `CNT-YYYYMMDD-NNNN`.
- **Price changes**: `POST /prices/change` (`PRICES_MANAGE`), `GET /prices/history?productId=…`.
  Creates `PriceChange` + `LabelReprintQueue` entry.
- **Labels**: `GET /labels/pending` (`LABELS_PRINT`), `POST /labels/printed` (mark printed).
- **Write-off**: `POST /inventory/write-off` (`STOCK_WRITE_OFF`) — writes WRITE_OFF movement.
- **Inventory overview**: `GET /inventory/overview` (`STOCK_VIEW`) — SKU count, low/out counts,
  stock value at cost/retail, expiring batch count/value.
- **Stock lookup**: `GET /inventory/lookup?q=…` (`STOCK_VIEW`) — search by barcode/SKU/name,
  returns per-location stock, batches, available qty.
- **Multi-line receive**: `POST /stock/receive-batch` (`STOCK_RECEIVE`) — receive multiple
  lines in one call (scan-to-receive workflow).

### Changed (contract)
- `POST /stock/receive` and `POST /inventory/adjust` now accept optional `locationId`,
  `lotNumber` (receive only), and `reasonCode`.
- `allocateFromBatches` accepts optional `locationId` filter and `allowExpired` flag; by default
  expired batches are skipped.
- `productMultiLocationAvailable` utility: sums sellable locations' on-hand minus reserved.
- Sales checkout now writes `SaleLineBatch` rows for every FEFO allocation (batch traceability).
- When `product.trackBatches` is true, checkout skips expired batches during allocation (unless
  the caller sends `allowExpiredSale: true` in the body — reserved for future manager override).
- Phase 3 permissions (`PRICES_MANAGE`, `LABELS_PRINT`, `STOCK_COUNT`, `STOCK_TRANSFER`,
  `STOCK_WRITE_OFF`, `LOCATIONS_MANAGE`) changed from "planned" to "active".

### Database (additive only)
- Migration `20261104120000_phase3_inventory_core`:
  - New enums: `AdjustReason`, `TransferStatus`, `StockCountType`, `StockCountStatus`,
    `LabelJobStatus`, `BarcodeKind`; new `MovementType` values `WRITE_OFF`, `COUNT`.
  - `Location` columns: `sellable`, `storeCode`, `sortOrder`, `binCode`, `isActive`, `createdAt`.
    Renames DEFAULT_STORE display name to "Shop floor"; inserts BACK_STORE + QUARANTINE.
  - `Product` columns: `nameAm`, `restockQty`, `minStock`, `maxStock`, `leadTimeDays`,
    `trackBatches`, `defaultLocationId`, `archivedAt`, `taxCategory`.
  - New tables: `ProductBarcode`, `SaleLineBatch`, `StockTransfer`, `StockTransferLine`,
    `StockCount`, `StockCountLine`, `PriceChange`, `LabelReprintQueue`, `InventorySnapshot`.
  - `StockBatch` columns: `locationId` (backfilled from DEFAULT_STORE), `lotNumber`.
  - `StockMovement` column: `reasonCode`.

### Seed
- Creates BACK_STORE (non-sellable) and QUARANTINE (non-sellable) alongside DEFAULT_STORE.
- Sets `sellable`, `storeCode`, `sortOrder` on all three locations.

## Phase 2 - design system (API changes only)

### Added (additive)
- `User.locale` column (`ALTER TABLE "User" ADD COLUMN "locale" TEXT`).
  Migration: `20261104000000_phase2_user_locale`.
- `PATCH /auth/me` accepts optional `locale` string field.
- `GET /auth/me` returns `locale` (defaults to `"en"` when null).
- JWT payload includes `locale`.

### No breaking changes
This phase is a client-side design-system overhaul. The only API change is the additive
`locale` field; no existing behaviour is altered.

## Phase 1 - one permission model

### Changed (contract)
- **Every route is guarded by permissions.** `@Roles(...)` and the `RolesGuard` are gone; only the
  OWNER role bypasses checks. Every route must declare `@RequirePermissions`, `@RequireAnyPermission`,
  `@AnyAuthenticated` or `@Public`; the API refuses to start if one does not.
  See [docs/PERMISSIONS.md](docs/PERMISSIONS.md) for the full route-to-permission mapping.
- **Roles hold exactly what is stored.** The silent fallback to code defaults is removed.
- **Cost and profit are hidden in API responses** unless the role has `REPORTS_VIEW_COST_PROFIT`
  (product cost, average cost, sale cost and net profit, dashboard profit and stock value, movement and
  batch unit costs, export columns). Changing a product's cost price needs the same permission.
  **After this phase only the owner sees cost and profit until a role is given the permission.**
- **Sales lists are scoped**: without `SALES_VIEW_ALL` a person sees only the sales they recorded.
- `/inventory/adjust` and `/inventory/return` need `STOCK_ADJUST`; `/inventory/expiry` needs
  `STOCK_VIEW`; creating a reservation needs `PRODUCTS_RESERVE`, completing one needs
  `RESERVATIONS_MANAGE` and `SALES_CREATE`; alert e-mails need `SETTINGS_EMAILS`; product photo
  uploads need `PRODUCTS_CREATE` or `PRODUCTS_EDIT`; deleting categories and product types needs the
  matching `*_MANAGE` key (it was owner-only).

### Added
- 31 permissions (sales scope, discounts, voids/refunds, price override, cash drawer, shifts, customers,
  purchasing, stock view/count/adjust/transfer/write-off, prices, locations, labels, cost/profit,
  exports, shop settings, audit log). Many are "planned": defined now, enforced in later phases.
- Permission catalog with labels, descriptions and sensitivity (`GET /roles/permissions`).
- **Manager approval PIN**: `PUT /auth/pin`, `GET /approvals/managers`, `POST /approvals`, single-use
  tokens (`X-Approval-Token`), lockout after 5 wrong tries. Used for stock corrections above the limit.
- Shop settings (`GET/PATCH /settings/store`): the adjustment approval limit (default Br 5,000).
- No-escalation rules: nobody can grant a permission they lack, edit their own role, create or assign
  an owner, or edit/reset a user whose role is stronger than theirs.
- `/auth/me` returns `hasPin`.

### Fixed
- Anyone allowed to manage users could create an owner account or reset the owner's password.
- Reservation responses embedded the product including its cost price.
- Stock-change responses (receive/adjust/return) returned the raw stock row including average cost.
- Stock-movement and batch responses embedded raw products and stock rows with cost fields.

### Database (additive)
- `20251105000000_phase1_permission_keys`: the new enum values (own migration: PostgreSQL cannot use a
  new enum value in the transaction that adds it).
- `20251105000100_phase1_permissions_backfill`: `User.pinHash/pinFailedAttempts/pinLockedUntil`,
  `Approval`, `StoreSetting`, and the backfill (defaults written out as rows for built-in roles with
  none; `SALES_VIEW_ALL` for `SALES_VIEW`, `STOCK_VIEW` for `STOCK_HISTORY_VIEW`; no sensitive key is
  ever granted).

### Behaviour changes to know about
- Cashiers and store staff no longer see cost and profit (sales page, dashboard, product cost, exports).
- Cashiers lose manual stock returns (`/inventory/return`, no screen used it). Store staff lose manual
  adjustments (`/inventory/adjust`, no screen used it). Both can be granted `STOCK_ADJUST`.
- `/inventory/expiry` follows `STOCK_VIEW`, which roles get from `STOCK_HISTORY_VIEW` (cashiers had
  API access to expiry by role name but never had the menu link).

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

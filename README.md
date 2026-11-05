# EdiMart API

NestJS + Prisma API for Edi's Collection mart.

## Develop, test, operate

```bash
npm install
cp .env.example .env            # fill in DATABASE_URL and JWT_SECRET
npm run db:migrate              # prisma migrate deploy
npm run start:dev               # http://localhost:4000
npm test                        # Jest + a real embedded PostgreSQL (no Docker or database needed)
npm run typecheck
```

| Command | What it does |
|---|---|
| `npm test` | Unit + end-to-end tests. Starts a throwaway PostgreSQL, applies every migration from scratch, checks the migrations match `schema.prisma`, then runs the checkout-race, idempotency, numbering, FEFO, reservation, permission, storage, seed and reconciliation tests. |
| `npm run reconcile` | **Read-only** report: stored stock vs the movement ledger, batches vs on-hand, negative stock, over-reservation. `-- --csv out.csv`, `-- --json out.json`, `-- --strict` (non-zero exit when anything is found). Never changes data. |
| `npm run db:seed` | First-run data for an **empty** database (refuses otherwise). Owner password from `ADMIN_INITIAL_PASSWORD` or generated and printed once. |
| `npm run uploads:migrate` | Dry run of moving existing uploads into `products/` and `proofs/`; add `-- --apply` to do it. |
| `npm run db:status` | `prisma migrate status`. |

### First run

1. Deploy, with `DATABASE_URL`, `JWT_SECRET`, `WEB_ORIGIN`, `PUBLIC_API_URL` set.
2. Create the owner: either `npm run db:seed` with a shell, or set `SETUP_ENABLED=1`,
   `SETUP_SECRET` and (optionally) `ADMIN_INITIAL_PASSWORD`, then
   `curl -X POST -H "X-Setup-Key: $SETUP_SECRET" https://<api>/setup/seed`.
   Read the one-time owner login from the server log (it is never returned in the response).
3. Sign in; you are asked to choose a new password straight away.
4. Set `SETUP_ENABLED=0` (or remove it) and redeploy. The setup routes then answer 404.

### Permissions

Every route is guarded by permissions; roles are bundles of permissions and only the owner bypasses
checks. See [docs/PERMISSIONS.md](docs/PERMISSIONS.md) for the model, cost/profit visibility, manager
PIN approvals and a checklist for adding a route. The API will not start if a route declares no
permission.

### Checkout contract

`POST /sales/checkout` needs an `Idempotency-Key` header (8-128 characters, one per sale attempt;
reuse it only to retry the *same* sale). Body: `lines[]`, optional `paymentMethod`
(`CASH` default, `TELEBIRR`, `CBE_BIRR`, `MPESA`, `BANK_TRANSFER`, `CARD`, `STORE_CREDIT`,
`CUSTOMER_ACCOUNT`), `paymentReference`, `proofImagePaths[]`, `notes`, and Phase 7 fields
`customerId`, `couponCode`, `loyaltyPointsToRedeem`, `promotionIds`. Not enough stock answers
`409` naming the product.

### Phase 7 — Customers, loyalty, promotions

- Customers: `GET/POST /customers`, `GET/PATCH /customers/:id`, `GET /customers/overdue`,
  `POST /customers/:id/repay|credit-limit|adjust-store-credit`,
  `GET /customers/:id/ledger|loyalty|statement`.
- Promotions: `GET/POST /promotions`, `PATCH /promotions/:id`, `POST /promotions/evaluate`,
  `GET /promotions/:id/usage`.
- Settings: `loyalty.pointsPerBirr`, `loyalty.birrPerRedeemPoint`, `loyalty.enabled`,
  `customers.defaultCreditLimit`.

### Phase 8 — Dashboards and reports

All under `/reporting` with `REPORTING_VIEW` (cost/profit fields need
`REPORTS_VIEW_COST_PROFIT`). Date presets: `today` | `yesterday` | `this_week` |
`this_month` | `last_month` | `custom` (`from`/`to` as YYYY-MM-DD, Africa/Addis_Ababa).

- Dashboards: `GET /reporting/dashboard`, `GET /reporting/inventory-dashboard`.
- Rebuild: `POST /reporting/rebuild-summaries` (`SETTINGS_MANAGE` or `REPORTING_VIEW`).
- Sales: `sales-by-day|hour|product|cashier|payment`, `discounts-voids-refunds`,
  `customers`, `vat-summary`, `shift-variances` (plus legacy `GET /reporting/sales`).
- Inventory: `stock-on-hand`, `valuation`, `movements`, `abc`, `turnover`,
  `dead-stock`, `overstock`, `shrinkage`, `expiry-losses`, `margin-alerts`.
- Purchasing: `purchases-by-supplier`, `open-pos`, `aged-payables`, `landed-cost`.
- CSV: add `?format=csv` on key reports, or `GET /reporting/export/:reportKey.csv`.

### Phase 9 — Sessions, TOTP, offline sync, reliability

- Sessions: `GET /auth/sessions`, `POST /auth/sessions/revoke-others`,
  `POST /auth/sessions/:id/revoke`, `POST /auth/logout`.
- TOTP: `POST /auth/totp/setup|enable|disable`; login may return `TOTP_REQUIRED`.
- Offline checkout fields on `POST /sales/checkout`: `clientSaleId`, `createdOffline`,
  `registerCode` (sale numbers `SALE-YYYYMMDD-{register}-NNNN`).
- Sync conflicts: `POST/GET /sync/conflicts`, `POST /sync/conflicts/:id/resolve`.
  Prefer normal stock-count / goods-receipt endpoints; on failure post a conflict.
- Audit: `GET /audit` (`AUDIT_VIEW`). Backups: [docs/BACKUPS.md](docs/BACKUPS.md).
- Optional `SENTRY_DSN` / `SENTRY_TRACES_SAMPLE_RATE`; structured logs via pino.

### Files

Product photos are public; payment proofs are private and only reachable through short-lived
signed links. `STORAGE_DRIVER=local` needs a persistent disk (Render's free tier has none: files
vanish on redeploy). For production use `STORAGE_DRIVER=s3` with Cloudflare R2, AWS S3 or Supabase
Storage (see `.env.example`), then run `npm run uploads:migrate -- --apply` once.

**Render free tier sleeps after inactivity** and is a poor fit for a live till. Use a paid
always-on instance (and durable storage / S3) for a shop that sells during the day.

### Migrations

See [docs/MIGRATIONS.md](docs/MIGRATIONS.md) for what was found in the migration history and the
proposed one-time repair. Nothing there has been run against production.

## Render setup (required)

In **Render** → **EdiMartApi** → **Settings**:

| Setting | Value |
|---------|--------|
| **Root Directory** | *(leave empty — repo root)* **NOT `src`** |
| **Build Command** | `npm install --include=dev && npm run build` |
| **Start Command** | `npm start` or `node scripts/render-start.js` |

If **Root Directory** is `src`, fix it: clear the field, save, redeploy. The start script can recover, but build must run from repo root.

**Important:** Do not use `yarn` unless your repo has `yarn.lock`. This project uses **npm** (`package-lock.json`). On Render set **Node** runtime and the build command above — or disable auto `yarn start`.

**Environment variables:** `DATABASE_URL`, `JWT_SECRET`, `WEB_ORIGIN`, `PUBLIC_API_URL`, `SETUP_SECRET`, `UPLOAD_DIR=./uploads`

Or use the included `render.yaml` blueprint when creating the service.

---

## Railway setup (optional)

The API **will not start** until these variables exist on the **EdiMartApi** service (not only on Postgres).

### 1. Link Postgres → API

1. Open your Railway project.
2. Click the **EdiMartApi** service (your GitHub deploy).
3. Go to **Variables**.
4. Click **+ New Variable** → **Add variable reference** (or **Connect** / reference from Postgres).
5. Select your **Postgres** service and add **one** of:
   - `DATABASE_URL` → `${{Postgres.DATABASE_URL}}` (recommended)
   - or `DATABASE_PRIVATE_URL` → `${{Postgres.DATABASE_PRIVATE_URL}}` (same project, private network)

   The API accepts either name.

### 2. Add JWT secret (manual)

Still on **EdiMartApi** → **Variables**, add:

| Name | Example |
|------|---------|
| `JWT_SECRET` | 48+ character random string (generate locally: `openssl rand -base64 48`) |
| `JWT_EXPIRES_IN` | `8h` |
| `WEB_ORIGIN` | Your Vercel URL, e.g. `https://edi-mart-client.vercel.app` |
| `PUBLIC_API_URL` | This API's public URL, e.g. `https://edimartapi-production.up.railway.app` |
| `UPLOAD_DIR` | `./uploads` |

### 3. Public URL (required)

On **EdiMartApi** → **Settings** → **Networking**:

- Enable **Public networking**
- Click **Generate domain** (e.g. `edimartapi-production.up.railway.app`)

Without this, the deploy logs may show “API listening” but the browser gets **Application failed to respond**.

### 4. Redeploy

After saving variables, trigger **Redeploy** on EdiMartApi.

### 5. Database sync on Railway

Deploy uses **`prisma db push`** on Railway (not migrate history), so a failed `20250516000000_init` migration will not block startup.

If the database is still broken from an earlier attempt:

1. EdiMartApi → **Variables** → add `RAILWAY_RESET_DB` = `1`
2. **Redeploy** once (wipes `public` schema and recreates tables)
3. **Remove** `RAILWAY_RESET_DB` and redeploy again

### 6. Seed (once) — no shell required (Render free tier)

**Option A — HTTP (easiest on Render free tier)**

1. On Render → **EdiMartApi** → **Environment**, add:
   - `SETUP_SECRET` = a long random string (e.g. same style as `JWT_SECRET`)
2. Redeploy, then run (PowerShell):

```powershell
$secret = "YOUR_SETUP_SECRET"
Invoke-RestMethod -Method POST `
  -Uri "https://edimartapi-1.onrender.com/setup/seed" `
  -Headers @{ "X-Setup-Key" = $secret }
```

Or use curl:

```bash
curl -X POST https://edimartapi-1.onrender.com/setup/seed \
  -H "X-Setup-Key: YOUR_SETUP_SECRET"
```

**Option B — From your PC** (Render → Postgres → External connection string):

```bash
cd EdiMartApi
set DATABASE_URL=postgresql://...
npm run db:seed
```

**Option C — Auto on empty DB:** set `AUTO_SEED=1` on Render and redeploy.

Check status: `GET https://edimartapi-1.onrender.com/setup/status`

Demo login: `owner@edisims.local` / `Owner123!`

## Local development

```bash
cp .env.example .env
# Edit DATABASE_URL and JWT_SECRET
npm install
npm run build
npm run start:dev
```

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run build` | Generate Prisma client + compile Nest |
| `npm run start` | Run API |
| `npm run db:migrate` | Apply migrations |
| `npm run db:seed` | Seed categories + catalog |

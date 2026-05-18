# EdiMart API

NestJS + Prisma API for Edi's Collection mart.

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

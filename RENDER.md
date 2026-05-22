# Render deploy checklist

## Required settings (EdiMartApi Web Service)

Open **Settings** and set exactly:

| Field | Value |
|-------|--------|
| **Root Directory** | *(delete everything — must be empty)* |
| **Build Command** | `bash build.sh` (monorepo root) or `bash apps/api/build.sh` |
| **Start Command** | `npm start` (with Root Directory = `apps/api`) |

### Monorepo on Render

- **Root Directory** empty → **Build Command** `bash build.sh` → **Start Command** `cd apps/api && npm start`
- **Root Directory** `apps/api` → **Build Command** `bash build.sh` → **Start Command** `npm start`

**Critical:** Do **not** use `yarn install; yarn build`. This repo is standalone (`edimart-api`) and uses **npm** + `package-lock.json`. Yarn will fail on `@edisims/database` if the monorepo `package.json` was ever pushed by mistake.

### Do NOT use

- Root Directory = `src` ← this breaks the build
- `yarn build` alone ← triggers `pnpm run generate` and can fail with `prisma: Permission denied`; use **bash build.sh** instead
- Start Command = `yarn start` ← use **npm**

## Environment variables

- `DATABASE_URL` — from Render Postgres (External URL) or your DB host
- `JWT_SECRET` — long random string
- `WEB_ORIGIN` — `https://edi-mart-client.vercel.app`
- `PUBLIC_API_URL` — `https://edimartapi-1.onrender.com`
- `SETUP_SECRET` — for one-time `POST /setup/seed`
- `UPLOAD_DIR` — `./uploads`

## Database

Startup runs **`prisma migrate deploy`** (not `db push`). Migrations preserve existing data when changing `Role.name` from enum to text.

If you previously used `db push` only, or an `init` migration failed (P3009), startup will **roll back failed records**, **baseline** migrations that already match your schema, then apply `20250520120000_role_name_string` only.

## After deploy

1. https://edimartapi-1.onrender.com/health
2. Seed: `POST /setup/seed` with header `X-Setup-Key: YOUR_SETUP_SECRET`
3. Login: `owner@edisims.local` / `Owner123!`

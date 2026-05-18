# EdiMart API

NestJS + Prisma API for Edi's Collection mart.

## Railway setup (required)

The API **will not start** until these variables exist on the **EdiMartApi** service (not only on Postgres).

### 1. Link Postgres → API

1. Open your Railway project.
2. Click the **EdiMartApi** service (your GitHub deploy).
3. Go to **Variables**.
4. Click **+ New Variable** → **Add variable reference** (or **Connect** / reference from Postgres).
5. Select your **Postgres** service and add:
   - `DATABASE_URL` → `${{Postgres.DATABASE_URL}}`  
     (or `DATABASE_PRIVATE_URL` if both services are in the same project — preferred for internal traffic)

### 2. Add JWT secret (manual)

Still on **EdiMartApi** → **Variables**, add:

| Name | Example |
|------|---------|
| `JWT_SECRET` | 48+ character random string (generate locally: `openssl rand -base64 48`) |
| `JWT_EXPIRES_IN` | `8h` |
| `WEB_ORIGIN` | Your Vercel URL, e.g. `https://edi-mart-client.vercel.app` |
| `PUBLIC_API_URL` | This API's public URL, e.g. `https://edimartapi-production.up.railway.app` |
| `UPLOAD_DIR` | `./uploads` |

### 3. Redeploy

After saving variables, trigger **Redeploy** on EdiMartApi.

### 4. Seed (once)

Railway shell on **EdiMartApi**:

```bash
npm run db:seed
```

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

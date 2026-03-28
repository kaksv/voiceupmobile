# Africastalking Talk — MoMo voice pilot

Voice-first mobile-money style assistant on [Africa’s Talking](https://africastalking.com/) (IVR + SMS OTP), with **demo transfers** (no live payments), **Postgres** sessions, and an **operator dashboard** (Vite + React). OpenAI is used **only on the server** for aggregated pilot insights (`POST /api/admin/ai/insights`).

## Repository layout

| Path | Role |
|------|------|
| `src/` | Express API, voice webhook, session store, admin routes |
| `frontend/` | Dashboard SPA (proxies `/api` and `/health` to the API in dev) |

npm **workspaces** link the root package and `frontend/`.

## Requirements

- Node.js 20+ (recommended)
- For production-style sessions and admin APIs: **PostgreSQL** (`DATABASE_URL`)
- Africa’s Talking account (Voice + SMS as needed)
- Optional: **OpenAI** API key for admin AI insights

## Quick start

```bash
cp .env.example .env
# Edit .env: AT_*, PUBLIC_BASE_URL, DATABASE_URL, ADMIN_TOKEN, OPENAI_API_KEY as needed

npm install
npm run dev
```

The API listens on **port 3000** by default (`PORT` in `.env`).

### Dashboard (local)

In a second terminal:

```bash
npm run dev:web
```

Vite serves the UI (default **5173**) and proxies `/api` and `/health` to `http://127.0.0.1:3000`. Store your admin token in the UI (saved in `localStorage`); requests use `Authorization: Bearer <ADMIN_TOKEN>`.

## Build and run (production)

```bash
npm run build:all   # compiles src/ → dist/ and frontend/ → frontend/dist/
npm start           # node dist/index.js
```

If `frontend/dist/index.html` exists, the same process also **serves the dashboard** at `/` (with SPA fallback). Paths `/api/*`, `/webhooks/*`, `/health`, and `/admin` are not rewritten to the SPA.

## Environment variables

See **`.env.example`** for the full list. Highlights:

| Variable | Purpose |
|----------|---------|
| `AT_USERNAME`, `AT_API_KEY` | Africa’s Talking API |
| `PUBLIC_BASE_URL` | HTTPS base URL of this app (no trailing slash); used for Voice callbacks |
| `DATABASE_URL` | Postgres (preferred session store; required for admin list APIs and AI context) |
| `REDIS_URL` | Optional Redis store if you are not using Postgres |
| `ADMIN_TOKEN` | Protects `/api/admin/*`; legacy HTML admin can pass `?token=` |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | Server-side chat completions for insights (`gpt-4o-mini` default) |
| `OTP_PEPPER` | HMAC secret for OTP hashing in production |

## HTTP endpoints

| Method / path | Description |
|---------------|-------------|
| `GET /health` | Liveness and config flags (SMS, DB, admin, OpenAI, etc.) |
| `POST /webhooks/voice/inbound` | Africa’s Talking Voice webhook (form-encoded) |
| `GET /admin` | Legacy HTML tables (sessions / demo transfers); token in UI or query |
| `GET /api/admin/sessions` | JSON sessions (masked phones); requires `ADMIN_TOKEN` |
| `GET /api/admin/transfers` | JSON demo transfers; requires `ADMIN_TOKEN` |
| `POST /api/admin/ai/insights` | Body `{ "message": "…" }`; requires `ADMIN_TOKEN`, Postgres, `OPENAI_API_KEY` |

## Africa’s Talking setup

1. Expose your app with a **public HTTPS** URL (e.g. ngrok) and set `PUBLIC_BASE_URL` to match.
2. Point the **Voice** inbound URL to `POST {PUBLIC_BASE_URL}/webhooks/voice/inbound`.
3. Use sandbox credentials while testing SMS/Voice.

## Deploying on Render (example)

1. Create a **PostgreSQL** instance and a **Web Service** from this repo.
2. Set environment variables from `.env.example` (including `DATABASE_URL` from the DB).
3. **Build command:** `npm run build:all`
4. **Start command:** `npm start`
5. Set `PUBLIC_BASE_URL` to your Render service URL (HTTPS, no trailing slash).

## Security notes

- Never expose `OPENAI_API_KEY` or `ADMIN_TOKEN` to the browser; the dashboard only sends the bearer token to your own backend.
- Admin and AI routes aggregate or mask phone data; do not log full E.164 numbers in shared logs if you can avoid it.

## Scripts (root)

| Script | Description |
|--------|-------------|
| `npm run dev` | API with `tsx watch` |
| `npm run dev:web` | Vite dev server for `frontend/` |
| `npm run build` | TypeScript compile only |
| `npm run build:web` | Vite production build only |
| `npm run build:all` | API + frontend (use for deploy) |
| `npm start` | Run compiled `dist/index.js` |

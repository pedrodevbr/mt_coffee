# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev    # Start in development mode (loads .env.development)
npm start      # Start in production mode (loads .env.production)
npm test       # Run tests (loads .env.test, requires a separate test DB)
```

There is no build step — this is a plain Node.js app.

## Environments

| File | Used when | Purpose |
|---|---|---|
| `.env.development` | `npm run dev` | Local development |
| `.env.test` | `npm test` | Test runs — **must point to a separate database** (tests truncate all tables) |
| `.env.production` | `npm start` / Replit | Production |

On Replit, env vars are injected by the platform; dotenv is only a local fallback.

## Environment Variables

| Variable             | Required | Notes                                     |
|----------------------|----------|-------------------------------------------|
| `DATABASE_URL`       | Yes      | PostgreSQL connection string              |
| `JWT_SECRET`         | No       | Falls back to `mt_coffee_fallback_secret` |
| `PORT`               | No       | Defaults to 5000                          |
| `OPENROUTER_API_KEY` | No       | Receipt LLM analysis via OpenRouter       |

## Architecture

Single-process Node.js app (Express 5) that serves both the REST API and the static frontend from the same server on port 5000.

**Backend (`server.js` + `database.js`)**
- `database.js` exports a `pg` connection pool and `initSchema()`, which runs `CREATE TABLE IF NOT EXISTS` for all tables and seeds default rows on first run. Called once at startup before the HTTP server begins listening.
- `server.js` mounts all API routes under `/api` and serves `public/` as static files. All unmatched routes fall back to `public/index.html` (SPA-style).
- Admin routes are protected by a JWT middleware (`requireAdmin`). The token is obtained via `POST /api/admin/login` with a PIN stored in the `settings` table (default `1234`). Token expiry is 12 hours.
- Uploaded receipt files (images/PDFs) are stored on disk in `uploads/receipts/` and served via streaming routes.

**Frontend (`public/`)**
- `index.html` / `js/main.js` — user-facing page: login by matricula, consume coffee, request balance recharge by uploading a payment receipt.
- `admin.html` / `js/admin.js` — admin panel, accessed by entering matricula `0000` on the main page. Requires PIN authentication to use any admin feature.

**Database schema (PostgreSQL)**

| Table               | Purpose                                              |
|---------------------|------------------------------------------------------|
| `users`             | User accounts; `matricula` is the login identifier  |
| `transactions`      | Every consumption and recharge event                 |
| `system_state`      | Single-row table: current stock (g), total cost, QR code URL, PIX key |
| `stock_history`     | One row per coffee purchase batch                    |
| `stock_adjustments` | Physical-count corrections (delta_cost always 0 — sunk cost model) |
| `settings`          | Key/value config (`dose_grams`, `admin_pin`)         |
| `extra_costs`       | One-off overhead costs spread across 1000 doses      |
| `payment_receipts`  | User-submitted PIX proof of payment, pending admin approval |

**Dose price formula**

```
base_price    = (stock_total_cost / coffee_stock_grams) * dose_grams
extra_per_dose = SUM(extra_costs.amount) / 1000
price_per_dose = base_price + extra_per_dose
```

Stock adjustments change `coffee_stock_grams` only; `stock_total_cost` is never adjusted (losses increase price per dose, gains decrease it).

**Tests (`tests/`)**
- `tests/env.js` — Jest `setupFiles` entry; loads `.env.test` before any module is required.
- `tests/setup.js` — exports `setupTestDb()`, `cleanDb()`, `closeDb()`. `cleanDb()` truncates all tables in FK-safe order while preserving the admin user and default settings.
- `tests/api.test.js` — integration tests using Supertest. Each `beforeEach` calls `cleanDb()` so tests are fully isolated.
- `server.js` exports `app` without starting a listener when `require.main !== module`, making it importable by tests.

**Balance recharge flow**
Users cannot credit their own balance directly. They upload a PIX payment receipt via the modal → admin reviews and approves it → `POST /api/admin/receipts/:id/approve` credits the balance and creates a `recharge` transaction atomically.

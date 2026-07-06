# `worker/` — Cloudflare Worker backend

Single Workers + Assets deploy: this Worker serves the built Svelte SPA from
its asset binding and routes `/api/*` to Hono handlers. Email content never
touches the backend — only identity, entitlement, and scan-log counts.

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/api/health` | none | Liveness check |
| `GET` | `/api/me` | Supabase JWT | `{paid, type, expires_at, trial_used}` |
| `POST` | `/api/scan-log` | Supabase JWT | Append to `scan_logs` (RLS-scoped) |
| `POST` | `/api/create-checkout-session` | Supabase JWT | Create Stripe hosted-checkout session |
| `POST` | `/api/webhooks/stripe` | Stripe signature | Upsert `entitlements` on `checkout.session.completed` |

## Local development

```bash
# From repo root:
cp .env.example .env    # single file — VITE_ vars for the SPA build +
                        # SUPABASE_* / STRIPE_* vars for the Worker runtime.

# Fill in the values from the staging Supabase dashboard
# (Project Settings → API) and Stripe test-mode dashboard.

npm install
npm run dev          # one terminal — Vite + Worker in a single process via
                     # @cloudflare/vite-plugin (workerd embedded in Vite's
                     # dev server). HMR for both client and server. /api/*
                     # routes to Hono handlers; SPA served at /.
```

Open http://localhost:5173 — same-origin for both the app and the API.

## Mock-paying a user in local dev

The paywall gate consults `GET /api/me`, which returns `paid: true` when an
`entitlements` row exists for the user. To unlock paid actions without
running the full Stripe checkout, insert a row directly:

```sql
INSERT INTO entitlements
  (user_id, type, stripe_session_id, stripe_customer_id, early_adopter)
VALUES (
  (SELECT id FROM auth.users WHERE email = 'YOUR_EMAIL'),
  'lifetime', 'mock_cs_001', 'mock_cus_001', true
);
```

Run it in the **Supabase staging SQL Editor** (Dashboard → SQL Editor). Sign
into the app at least once first so `auth.users` has your row.

To re-lock:

```sql
DELETE FROM entitlements
WHERE user_id = (SELECT id FROM auth.users WHERE email = 'YOUR_EMAIL');
```

## Service-role usage

`SUPABASE_SECRET_KEY` bypasses RLS. **Only the Stripe webhook handler uses
it** — every other path constructs a client from the user's JWT so RLS
enforces who can read/write what.

## Deploy

Deploys are automated (Phase 7a):

- **Staging** — every push to `main` triggers `ci.yml`'s `deploy-staging` job
  (`wrangler deploy --env staging` after tests pass).
- **Production** — pushing a `v*.*.*` tag triggers `release.yml`, which
  pauses at the `production` GitHub Environment gate for reviewer approval,
  then `wrangler deploy --env production`. `workflow_dispatch` on the same
  workflow is the manual-override path.

Both environments read `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY`
from their respective GitHub Environment secrets at build time. Worker
runtime secrets (`SUPABASE_*`, `STRIPE_*`) are set per environment via
`wrangler secret put --env {staging,production} <NAME>`.

For a first-time environment bring-up, the 6 runtime secrets are:

```
wrangler secret put SUPABASE_URL --env <env> -c wrangler.toml
wrangler secret put SUPABASE_PUBLISHABLE_KEY --env <env> -c wrangler.toml
wrangler secret put SUPABASE_SECRET_KEY --env <env> -c wrangler.toml
wrangler secret put STRIPE_SECRET_KEY --env <env> -c wrangler.toml
wrangler secret put STRIPE_WEBHOOK_SECRET --env <env> -c wrangler.toml
wrangler secret put STRIPE_PRICE_ID --env <env> -c wrangler.toml
```

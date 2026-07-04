# `worker/` — Cloudflare Worker backend

Single Workers + Assets deploy: this Worker serves the built Svelte SPA from
its asset binding and routes `/api/*` to Hono handlers. Email content never
touches the backend — only identity, entitlement, and scan logs.

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/api/health` | none | Liveness check |
| `GET` | `/api/me` | Supabase JWT | `{paid, type, expires_at, trial_used}` |
| `POST` | `/api/scan-log` | Supabase JWT | Append to `scan_logs` (RLS-scoped) |
| `POST` | `/api/webhooks/lemonsqueezy` | HMAC | Upsert `entitlements` (Phase 5 — currently stub) |

## Local development

```bash
# From repo root:
cp .env.example .env                # frontend env (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY)
cp .dev.vars.example .dev.vars      # worker env (SUPABASE_URL + anon + service-role keys)

# Fill in the values from the staging Supabase dashboard
# (Project Settings → API).

npm install
npm run dev          # one terminal — Vite + Worker in a single process via
                     # @cloudflare/vite-plugin (workerd embedded in Vite's
                     # dev server). HMR for both client and server. /api/*
                     # routes to Hono handlers; SPA served at /.
```

Open http://localhost:5173 — same-origin for both the app and the API.

## Mock-paying a user in local dev

The paywall gate consults `GET /api/me`, which returns `paid: true` when an
`entitlements` row exists for the user. Until LemonSqueezy is wired up
(Phase 5), unlock paid actions by inserting a row directly:

```sql
INSERT INTO entitlements
  (user_id, type, lemonsqueezy_order_id, lemonsqueezy_customer_id, early_adopter)
VALUES (
  (SELECT id FROM auth.users WHERE email = 'YOUR_EMAIL'),
  'lifetime', 'mock-001', 'mock-cust-001', true
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

`SUPABASE_SERVICE_ROLE_KEY` bypasses RLS. **Only the LemonSqueezy webhook
handler uses it** — every other path constructs a client from the user's JWT
so RLS enforces who can read/write what.

## Deploy

```bash
# Set secrets once per environment:
wrangler secret put SUPABASE_URL --env staging
wrangler secret put SUPABASE_ANON_KEY --env staging
wrangler secret put SUPABASE_SERVICE_ROLE_KEY --env staging
wrangler secret put LEMONSQUEEZY_WEBHOOK_SECRET --env staging

# Deploy (runs `vite build` then `wrangler deploy` against the generated
# dist/scrubinbox/wrangler.json):
npm run deploy
npm run deploy -- --env staging
```

Multi-environment wrangler config (`[env.staging]`, `[env.production]`)
lands as part of Phase 7a.

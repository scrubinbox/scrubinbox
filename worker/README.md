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
npm run dev          # Vite SPA on :5173 with HMR
npm run dev:worker   # in a second terminal — wrangler on :8787
```

Vite proxies `/api/*` to wrangler, so the browser only ever talks to
`http://localhost:5173` — no CORS to fight.

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

# Deploy:
npm run deploy                 # builds SPA + deploys Worker (default env)
npm run deploy -- --env staging
```

Multi-environment wrangler config (`[env.staging]`, `[env.production]`)
lands as part of Phase 7a.

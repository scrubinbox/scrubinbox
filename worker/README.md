# `worker/` — Cloudflare Worker backend

Single Workers + Assets deploy: this Worker serves the built Svelte SPA from
its asset binding and routes `/api/*` to Hono handlers. Email content never
touches the backend — only identity, entitlement, Google refresh tokens
(AES-GCM-encrypted at rest), and scan-log counts.

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/api/health` | none | Liveness check |
| `GET` | `/api/auth/google/start` | none | Redirect to Google OAuth (sets `oauth_state` cookie) |
| `GET` | `/api/auth/google/callback` | Google | Exchange code, upsert user, set `sb_session` cookie |
| `POST` | `/api/auth/signout` | session | Clear the session cookie |
| `GET` | `/api/auth/gmail-token` | session | Return `{access_token, expires_at}` — Google access token refreshed from the encrypted refresh token in Neon |
| `GET` | `/api/me` | session | `{id, email, paid, type, expires_at, trial_used}` |
| `POST` | `/api/scan-log` | session | Append to `scan_logs` (`user_id` bound from session) |
| `POST` | `/api/create-checkout-session` | session | Create Stripe hosted-checkout session |
| `POST` | `/api/webhooks/stripe` | Stripe signature | Upsert `entitlements` on `checkout.session.completed` |

## Local development

```bash
# From repo root:
cp .env.example .env

# Fill in values:
#   DATABASE_URL                  Neon staging branch pooled connection string
#   GOOGLE_CLIENT_ID/SECRET       staging Google OAuth client
#                                 (add http://localhost:5173/api/auth/google/callback
#                                 to its Authorized redirect URIs first)
#   SESSION_SIGNING_SECRET        openssl rand -base64 32
#   REFRESH_TOKEN_ENCRYPTION_KEY  openssl rand -base64 32
#   STRIPE_*                      test-mode; run `stripe listen --forward-to
#                                 http://localhost:5173/api/webhooks/stripe`
#                                 to get a whsec_

npm install
npm run dev          # one terminal — Vite + Worker in a single process via
                     # @cloudflare/vite-plugin (workerd embedded in Vite's
                     # dev server). HMR for both client and server. /api/*
                     # routes to Hono handlers; SPA served at /.
```

Open http://localhost:5173 — same-origin for both the app and the API.

## Applying schema changes to Neon

Migrations live in `db/migrations/`. Applied via plain `psql`:

```bash
psql "$DATABASE_URL" -f db/migrations/0001_init.sql
```

Neon's HTTP driver used at runtime doesn't handle DDL well; `psql` (or
`neon` CLI) is the right tool for one-shot schema work. Add a proper
migration runner (dbmate / drizzle-kit) once migration cadence justifies it.

## Mock-paying a user in local dev

The paywall gate consults `GET /api/me`, which returns `paid: true` when an
`entitlements` row exists for the user. To unlock paid actions without
running the full Stripe checkout, insert a row directly:

```sql
insert into entitlements
  (user_id, type, stripe_session_id, stripe_customer_id, early_adopter)
values (
  (select id from users where email = 'YOUR_EMAIL'),
  'lifetime', 'mock_cs_001', 'mock_cus_001', true
);
```

Run against the Neon staging branch (Neon dashboard → SQL Editor, or
`psql "$DATABASE_URL"`). Sign in at least once first so a `users` row exists.

To re-lock:

```sql
delete from entitlements
where user_id = (select id from users where email = 'YOUR_EMAIL');
```

## Refresh-token storage

`users.encrypted_refresh_token` is AES-256-GCM-encrypted with the Worker's
`REFRESH_TOKEN_ENCRYPTION_KEY` before write. Format: `iv (12 bytes) ||
ciphertext (includes auth tag)`. Only the Worker can decrypt — no plaintext
refresh tokens ever leave process memory, and none reach the client.

The Stripe webhook path is the only handler that writes user data without an
active session cookie; Stripe's HMAC signature (verified via
`constructEventAsync`) is what authorizes those writes.

## Deploy

Deploys are automated (Phase 7a):

- **Staging** — every push to `main` triggers `ci.yml`'s `deploy-staging` job
  (`wrangler deploy --env staging` after tests pass).
- **Production** — pushing a `v*.*.*` tag triggers `release.yml`, which
  pauses at the `production` GitHub Environment gate for reviewer approval,
  then `wrangler deploy --env production`. `workflow_dispatch` on the same
  workflow is the manual-override path.

The client bundle no longer requires any per-environment `VITE_` auth vars —
the roll-own OAuth flow runs entirely in the Worker, so the same bundle can
target staging or production.

For a first-time environment bring-up, the 8 runtime secrets are:

```
wrangler secret put DATABASE_URL --env <env> -c wrangler.toml
wrangler secret put GOOGLE_CLIENT_ID --env <env> -c wrangler.toml
wrangler secret put GOOGLE_CLIENT_SECRET --env <env> -c wrangler.toml
wrangler secret put SESSION_SIGNING_SECRET --env <env> -c wrangler.toml
wrangler secret put REFRESH_TOKEN_ENCRYPTION_KEY --env <env> -c wrangler.toml
wrangler secret put STRIPE_SECRET_KEY --env <env> -c wrangler.toml
wrangler secret put STRIPE_WEBHOOK_SECRET --env <env> -c wrangler.toml
wrangler secret put STRIPE_PRICE_ID --env <env> -c wrangler.toml
```

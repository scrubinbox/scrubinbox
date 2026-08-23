# ScrubInbox

Declutter your Gmail inbox by sender domain. Scan, group thousands of newsletters and receipts by who sent them, then bulk-move to trash. Email bodies stay in your browser — the server only sees sender and subject headers in-flight and stores nothing of it.

[![CI](https://github.com/scrubinbox/scrubinbox/actions/workflows/ci.yml/badge.svg)](https://github.com/scrubinbox/scrubinbox/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Use ScrubInbox

The hosted app is the only supported way to use ScrubInbox: [**app.scrubinbox.com**](https://app.scrubinbox.com). One-time **$4.99 early-adopter lifetime license.** Sign in with Google, pay through Stripe, clean up. See our [Privacy Policy](https://scrubinbox.com/privacy.html) for what data is stored where.

The source is public and MIT-licensed so anyone can audit exactly what the app does with their Google account. Auditability is the trust mechanism, not a supported self-host workflow — we don't build for, document, or maintain a self-host path.

## How it works

1. **Sign in** with Google to grant scoped access to Gmail
2. **Scan** your inbox — threads are grouped by sender domain
3. **Review** each domain, see counts and sample subject lines
4. **Preview** what will be deleted
5. **Trash** the selected threads in one bulk operation

Starred threads and threads with labels you excluded are automatically protected and never appear in scan results.

### Why not exclude "Important" emails?

Gmail's `IMPORTANT` label is applied automatically by Google's priority-inbox algorithm — it isn't an explicit user action. In practice Gmail marks the majority of inbox threads as important, so excluding them would silently discard most scan results. `STARRED`, by contrast, is always a deliberate user action, so starred threads are always excluded.

### Why client-side filtering?

Thread filtering (label exclusion, starred exclusion) happens client-side after fetching threads from the Gmail API rather than via Gmail query operators like `-label:Name`. We tested server-side filtering via the `threads.list` `q` parameter and found it unreliable for real-world label names.

**The `-label:` operator silently fails for labels with spaces or slashes.** Gmail's query parser treats spaces as delimiters, so `-label:Work Projects` is parsed as `-label:Work` plus the search term `Projects` — the exclusion is lost and results are unfiltered. Neither quoting (`-label:"Work Projects"`) nor hyphenating (`-label:Work-Projects`) fixes this. Nested labels with `/` like `Finance/Receipts` also fail the same way.

For simple single-word labels like `Newsletters`, `-label:Newsletters` works correctly. But since there's no way to know which labels in a user's account will work and which won't, we can't rely on it.

Verified empirically against the Gmail API:

```
Label exclusion test: "Newsletters"      -- simple name
  label:Newsletters                         1    ← correct, 1 thread has this label
  -in:trash -in:spam -label:Newsletters   500    ← correct, excludes the 1 thread
  Consistency: 501 ≈ 1 + 500 = 501  ✓

Label exclusion test: "Work Projects"    -- spaces in name
  label:Work Projects                     501    ← WRONG, returns all threads
  -in:trash -in:spam -label:Work Projects 501    ← WRONG, excludes nothing
  Consistency: 501 ≈ 501 + 501 = 1002  ✗
```

Client-side filtering against the actual `labelIds` returned by `threads.get` is reliable regardless of label name format.

## Privacy positioning

- **Email bodies stay in your browser.** Gmail API calls run through our Cloudflare Worker so we can enforce the paywall at the trust boundary. What transits the Worker is thread metadata (From, Subject, label IDs) — held in Worker memory for the duration of the request and never persisted.
- **The backend stores only what's needed to run the paid service:** your account (Google user ID + email), your entitlement (paid or not), an AES-256-GCM-encrypted copy of your Google refresh token, and running scan/trash counts.
- **Sub-processors are named in the** [Privacy Policy](https://scrubinbox.com/privacy.html): Neon (Postgres), Stripe (payments as Merchant of Record), Cloudflare (hosting), Google (OAuth + Gmail API).
- **Trust the auditability, not our claims.** The Worker source is open. Every commit and every deploy is visible.

## Contributing

Bug reports, feature requests, and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Development

Contributors who want to run the app locally to test changes need the same set of external services the hosted app uses (Neon, Google OAuth, Stripe). This is a working setup for development purposes, not a supported self-host path.

### Prerequisites

- Node.js 22.15+ (required by `@cloudflare/vite-plugin`)
- A Neon Postgres database (free tier is fine)
- A Google Cloud OAuth client configured with your local dev callback URL
- A Stripe account in test mode (only needed if you're touching the paywall or checkout flow)

### Setup

```bash
cp .env.example .env
# Fill in the values — .env.example has annotated slots for the
# Worker-facing DATABASE_URL, GOOGLE_CLIENT_*, STRIPE_*, SESSION_JWT_SECRET,
# and REFRESH_TOKEN_ENCRYPTION_KEY.

npm install
npm run dev
```

`npm run dev` starts Vite with `@cloudflare/vite-plugin` embedded, so a real workerd Worker serves `/api/*` and Vite serves the SPA on the same port (no proxy). Both read from the single `.env` file.

### Test & Build

```bash
npm test              # Vitest
npm run typecheck:worker
npm run build         # vite build; outputs to dist/
```

### Deployment

The hosted `app.scrubinbox.com` is a single Cloudflare Worker that serves both the SPA and `/api/*`. See `wrangler.toml` and the CI workflows in `.github/workflows/` for the deploy pattern:

- Push to `main` → `wrangler deploy --env staging`
- Tag `v*.*.*` → `wrangler deploy --env production` (gated by GitHub environment reviewer)

## Repository structure

- `src/` — Svelte 5 SPA
- `worker/` — Cloudflare Worker (Hono + Stripe SDK + Neon serverless driver)
- `landing/` — marketing site at `scrubinbox.com` (static HTML)
- `db/migrations/` — Postgres schema
- `.github/workflows/` — CI (staging deploy) + release (production deploy)

The production hosting infrastructure (Cloudflare zone, DNS records, Neon connection strings) lives in a private companion repo (`scrubinbox-infra`) and is not needed to run the app locally.

## Disclaimer

ScrubInbox modifies your Gmail inbox by moving threads to trash. Always use preview mode first and review your selections carefully. **Use at your own risk.** Trashed emails remain recoverable from Gmail's Trash folder for 30 days.

## License

[MIT](LICENSE)

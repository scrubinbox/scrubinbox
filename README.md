# ScrubInbox

Declutter your Gmail inbox by sender domain. Scan, group thousands of newsletters and receipts by who sent them, then bulk-move to trash. Email content stays in your browser.

[![CI](https://github.com/scrubinbox/scrubinbox/actions/workflows/ci.yml/badge.svg)](https://github.com/scrubinbox/scrubinbox/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Three ways to use ScrubInbox

### 1. Hosted app — [app.scrubinbox.com](https://app.scrubinbox.com)

One-time **$4.99 early-adopter lifetime license.** Sign in with Google, pay through Stripe, clean up. This is the simplest path — you don't set up anything and we handle keeping the OAuth verification, backend, and payments running. See our [Privacy Policy](https://scrubinbox.com/privacy.html) for what data is stored where.

### 2. Self-host

The entire application is open source under the MIT License. You can run your own instance if you'd rather host it yourself. Two things to know up front:

- The **paywall + auth stack is baked into the current build** (Supabase for identity + entitlement, a Cloudflare Worker for the API, Stripe for payments). Running the current `main` branch as-is means standing up all three services for your own account.
- A dedicated **`VITE_SCRUBINBOX_MODE=selfhost` toggle that skips the Supabase/Stripe/Workers layer** and runs the app in its original pure-client-side mode is planned but not yet shipped. Track progress in Phase 6 of the roadmap or file an issue if you want to help.

If you self-host, you are the data controller for your own instance — our Privacy Policy and Terms of Service do not apply.

### 3. Contribute

Bug reports, feature requests, and pull requests are all welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

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

- **Email content stays in your browser.** All Gmail API calls go directly from your browser to Google. No sender addresses, subject lines, or thread bodies are ever transmitted to any ScrubInbox-controlled backend.
- **The backend stores only what's needed to run the paid service:** your account (Supabase user ID + Google email), your entitlement (paid or not), and running scan/trash counts. No email metadata.
- **Sub-processors are named in the** [Privacy Policy](https://scrubinbox.com/privacy.html): Supabase (auth + DB), Stripe (payments as Merchant of Record), Cloudflare (hosting), Google (OAuth + Gmail API).
- **Self-hosted mode has no backend at all** — you're only touching your own Google account. (Reminder: the mode toggle isn't shipped yet; see above.)

## Development

### Prerequisites

- Node.js 22.15+ (required by `@cloudflare/vite-plugin`)
- A Supabase project for local auth (or an equivalent Postgres + auth setup)
- A Google Cloud OAuth client wired to your Supabase project (see [Supabase's Google auth guide](https://supabase.com/docs/guides/auth/social-login/auth-google))

### Setup

```bash
cp .env.example .env
# Fill in VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY

cp .dev.vars.example .dev.vars 2>/dev/null || echo "See .dev.vars section below"
# Set the Worker-side secrets for local dev — see below

npm install
npm run dev
```

`npm run dev` starts Vite with `@cloudflare/vite-plugin` embedded, so a real workerd Worker serves `/api/*` and Vite serves the SPA on the same port (no proxy).

The Worker reads its secrets from `.dev.vars` (gitignored). Minimum for the app to boot:

```
SUPABASE_URL=<same as VITE_SUPABASE_URL>
SUPABASE_PUBLISHABLE_KEY=<same as VITE_SUPABASE_PUBLISHABLE_KEY — `sb_publishable_...`>
SUPABASE_SECRET_KEY=<from Supabase dashboard — `sb_secret_...`>
```

For payment testing, also set:

```
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_ID=price_...
```

Stripe test-mode is fine for local development.

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
- `worker/` — Cloudflare Worker (Hono + Stripe SDK + Supabase JS)
- `landing/` — marketing site at `scrubinbox.com` (static HTML)
- `supabase/migrations/` — Postgres schema for the hosted service
- `.github/workflows/` — CI (staging deploy) + release (production deploy)

The production hosting infrastructure (Cloudflare zone, DNS records, Supabase projects) lives in a private companion repo (`scrubinbox-infra`) and is not needed to run or self-host this app.

## Disclaimer

ScrubInbox modifies your Gmail inbox by moving threads to trash. Always use preview mode first and review your selections carefully. **Use at your own risk.** Trashed emails remain recoverable from Gmail's Trash folder for 30 days.

## License

[MIT](LICENSE)

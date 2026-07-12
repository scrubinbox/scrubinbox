-- Bootstrap schema for ScrubInbox on Neon Postgres.
--
-- See productization.md Phase 2b for the design. Authorization is enforced in
-- the Worker (no RLS): every handler binds `user_id = $1` from the verified
-- session JWT's sub claim. Neon has no `auth.users` schema — we own the
-- `users` table directly, and populate it from Google OAuth id_token claims.

create extension if not exists pgcrypto;

create table users (
  id                      uuid primary key default gen_random_uuid(),
  google_sub              text unique not null,
  email                   text not null,
  encrypted_refresh_token bytea,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

comment on table users is
  'Owned by the Worker OAuth flow. google_sub is the stable Google account identifier from the id_token. encrypted_refresh_token is AES-GCM-encrypted with the Worker''s REFRESH_TOKEN_ENCRYPTION_KEY; iv is prefixed to the ciphertext.';

create table entitlements (
  user_id             uuid primary key references users(id) on delete cascade,
  type                text not null check (type in ('lifetime', 'annual')),
  expires_at          timestamptz,
  stripe_session_id   text unique not null,
  stripe_customer_id  text not null,
  early_adopter       boolean not null default false,
  created_at          timestamptz not null default now()
);

comment on table entitlements is
  'One row per paying user. Existence + (expires_at IS NULL OR expires_at > now()) = paid. Refunds/chargebacks delete the row (manual for MVP). Written only by the Stripe webhook handler.';

create table trial_state (
  user_id       uuid primary key references users(id) on delete cascade,
  trial_used_at timestamptz,
  created_at    timestamptz not null default now()
);

comment on table trial_state is
  'Tracks the single free scan per user. trial_used_at IS NULL = trial available. Worker inserts on first sign-in (was a trigger under the Supabase auth.users schema).';

create table scan_logs (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references users(id) on delete cascade,
  scanned_at      timestamptz not null default now(),
  threads_scanned int,
  threads_trashed int
);

create index scan_logs_user_scanned_at
  on scan_logs (user_id, scanned_at desc);

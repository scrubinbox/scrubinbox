-- Initial schema for ScrubInbox hosted product.
--
-- See productization.md Phase 2 for the design rationale. Three tables:
--
--   entitlements  one row per paying user; presence = paid. Written only by the
--                 Worker's service-role webhook handler (LemonSqueezy webhook).
--   trial_state   one row per user; tracks the single free scan (server-enforced
--                 gating). Seeded by a trigger on auth.users insert.
--   scan_logs     per-scan record for analytics, not for gating.
--
-- RLS policies and the auth.users trigger live in the next migration so each
-- migration stays single-purpose.

create table public.entitlements (
  user_id                  uuid primary key references auth.users(id) on delete cascade,
  type                     text not null check (type in ('lifetime', 'annual')),
  expires_at               timestamptz,
  lemonsqueezy_order_id    text unique not null,
  lemonsqueezy_customer_id text not null,
  early_adopter            boolean not null default false,
  created_at               timestamptz not null default now()
);

comment on table public.entitlements is
  'One row per paying user. Existence + (expires_at IS NULL OR expires_at > now()) = paid. Refunds/chargebacks delete the row (manual for MVP).';

create table public.trial_state (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  trial_used_at timestamptz,
  created_at    timestamptz not null default now()
);

comment on table public.trial_state is
  'Tracks the single free scan per user. trial_used_at IS NULL = trial available.';

create table public.scan_logs (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  scanned_at      timestamptz not null default now(),
  threads_scanned int,
  threads_trashed int
);

create index scan_logs_user_scanned_at
  on public.scan_logs (user_id, scanned_at desc);

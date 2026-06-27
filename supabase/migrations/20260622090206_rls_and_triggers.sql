-- Row-Level Security policies + trial_state seeding trigger.
--
-- Principle: the Worker's webhook handler uses the service-role key (bypasses
-- RLS) for writes to entitlements. Everything else flows through user JWTs and
-- is RLS-gated.

alter table public.entitlements enable row level security;
alter table public.trial_state  enable row level security;
alter table public.scan_logs    enable row level security;

-- --- entitlements ---
-- Users can read their own entitlement row only; no client writes.
-- (Service role bypasses RLS, so the Worker webhook handler can still insert.)

create policy entitlements_select_own
  on public.entitlements
  for select
  to authenticated
  using (auth.uid() = user_id);

-- --- trial_state ---
-- Users can read and update (mark trial as used) their own row.
-- The row itself is created by the trigger below on user creation.

create policy trial_state_select_own
  on public.trial_state
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy trial_state_update_own
  on public.trial_state
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- --- scan_logs ---
-- Users can read and insert their own scan log rows.

create policy scan_logs_select_own
  on public.scan_logs
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy scan_logs_insert_own
  on public.scan_logs
  for insert
  to authenticated
  with check (auth.uid() = user_id);

-- --- trial_state seeding trigger ---
-- Every new auth.users insert gets a corresponding trial_state row with
-- trial_used_at NULL (trial available). Avoids the "is row missing or is the
-- trial unused?" ambiguity on the client.

create function public.seed_trial_state()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.trial_state (user_id) values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created_seed_trial_state
  after insert on auth.users
  for each row execute function public.seed_trial_state();

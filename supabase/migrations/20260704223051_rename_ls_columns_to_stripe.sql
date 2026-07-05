-- Payments migrated from LemonSqueezy to Stripe Managed Payments (2026-07-04
-- decisions log). Rename the entitlement columns so the names match the actual
-- payment processor. Data preserved by rename — no writes have happened yet on
-- staging or prod, but the rename is safe either way.

alter table public.entitlements rename column lemonsqueezy_order_id to stripe_session_id;
alter table public.entitlements rename column lemonsqueezy_customer_id to stripe_customer_id;

comment on table public.entitlements is
  'One row per paying user. Existence + (expires_at IS NULL OR expires_at > now()) = paid. '
  'stripe_session_id is the Checkout Session id from checkout.session.completed. '
  'Refunds/chargebacks delete the row (manual for MVP).';

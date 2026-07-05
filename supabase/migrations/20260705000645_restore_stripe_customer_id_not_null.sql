-- Revert 20260704232014: with `customer_creation: 'always'` on every checkout
-- session, `session.customer` is guaranteed populated in the webhook payload,
-- so the entitlements schema can enforce the invariant.
--
-- The two failed webhook events that motivated the nullable pass (pre-customer-
-- creation-always) are being discarded from Stripe's test dashboard rather than
-- retried, so no rows with null stripe_customer_id will land.

alter table public.entitlements alter column stripe_customer_id set not null;

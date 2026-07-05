-- Stripe Checkout only creates Customer objects on-demand — a one-time payment
-- with `customer_creation: 'if_required'` (the default) completes with
-- session.customer = null. Relaxing the NOT NULL constraint lets those
-- webhooks land cleanly.
--
-- We also start passing `customer_creation: 'always'` from the Worker so that
-- future purchases DO produce a customer id, but existing failed webhooks and
-- any future one-time flow that doesn't force customer creation stay valid.

alter table public.entitlements alter column stripe_customer_id drop not null;

import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js'
import Stripe from 'stripe'
import { z } from 'zod'

type Env = {
  SUPABASE_URL: string
  SUPABASE_ANON_KEY: string
  SUPABASE_SERVICE_ROLE_KEY: string
  STRIPE_SECRET_KEY: string
  STRIPE_WEBHOOK_SECRET: string
  STRIPE_PRICE_ID: string
  ASSETS: { fetch: (req: Request) => Promise<Response> }
}

type AuthedVars = {
  user: User
  supabase: SupabaseClient
}

const app = new Hono<{ Bindings: Env; Variables: AuthedVars }>()

// Stripe SDK bound to fetch — required on Workers (default Node http agent
// isn't available). constructEventAsync uses SubtleCrypto for signature
// verification, also Workers-safe.
function stripeClient(env: Env): Stripe {
  return new Stripe(env.STRIPE_SECRET_KEY, {
    httpClient: Stripe.createFetchHttpClient(),
  })
}

// --- Auth middleware ---
// Constructs a Supabase client bound to the caller's JWT, then validates it.
// Subsequent handlers can use c.var.supabase for RLS-scoped queries and
// c.var.user for the verified user record.
const requireAuth = createMiddleware<{ Bindings: Env; Variables: AuthedVars }>(
  async (c, next) => {
    const header = c.req.header('Authorization')
    if (!header?.startsWith('Bearer ')) {
      return c.json({ error: 'missing bearer token' }, 401)
    }
    const jwt = header.slice('Bearer '.length)

    const supabase = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const { data, error } = await supabase.auth.getUser(jwt)
    if (error || !data.user) {
      return c.json({ error: 'invalid or expired token' }, 401)
    }
    c.set('user', data.user)
    c.set('supabase', supabase)
    await next()
  },
)

// --- API routes ---
const api = new Hono<{ Bindings: Env; Variables: AuthedVars }>()

api.get('/health', (c) => c.json({ service: 'scrubinbox-api', ok: true }))

api.get('/me', requireAuth, async (c) => {
  const supabase = c.var.supabase
  const userId = c.var.user.id

  const [entitlementRes, trialRes] = await Promise.all([
    supabase
      .from('entitlements')
      .select('type, expires_at')
      .eq('user_id', userId)
      .maybeSingle(),
    supabase
      .from('trial_state')
      .select('trial_used_at')
      .eq('user_id', userId)
      .maybeSingle(),
  ])

  if (entitlementRes.error) return c.json({ error: entitlementRes.error.message }, 500)
  if (trialRes.error) return c.json({ error: trialRes.error.message }, 500)

  const ent = entitlementRes.data
  const paid =
    !!ent && (ent.expires_at === null || new Date(ent.expires_at).getTime() > Date.now())

  return c.json({
    paid,
    type: ent?.type ?? null,
    expires_at: ent?.expires_at ?? null,
    trial_used: !!trialRes.data?.trial_used_at,
  })
})

const scanLogSchema = z.object({
  threads_scanned: z.number().int().nonnegative(),
  threads_trashed: z.number().int().nonnegative(),
})

api.post('/scan-log', requireAuth, async (c) => {
  const body = await c.req.json().catch(() => null)
  const parsed = scanLogSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'invalid body', issues: parsed.error.issues }, 400)
  }

  const { error } = await c.var.supabase
    .from('scan_logs')
    .insert({
      user_id: c.var.user.id,
      threads_scanned: parsed.data.threads_scanned,
      threads_trashed: parsed.data.threads_trashed,
    })

  if (error) return c.json({ error: error.message }, 500)
  return c.json({ ok: true }, 201)
})

// --- POST /api/create-checkout-session ---
// Creates a Stripe hosted checkout session for the ScrubInbox Lifetime price.
// The user's Supabase id rides in session.metadata.user_id — the webhook uses
// it to link the resulting entitlement row back to auth.users.
api.post('/create-checkout-session', requireAuth, async (c) => {
  const stripe = stripeClient(c.env)
  const origin = new URL(c.req.url).origin

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [{ price: c.env.STRIPE_PRICE_ID, quantity: 1 }],
    // {CHECKOUT_SESSION_ID} is a Stripe template — replaced with the actual id
    // when Stripe redirects the customer to success_url. /welcome uses it to
    // correlate the pending purchase with the eventual webhook.
    success_url: `${origin}/welcome?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/`,
    customer_email: c.var.user.email ?? undefined,
    metadata: { user_id: c.var.user.id },
    // Automatic tax handled by Managed Payments — we don't set tax settings here.
  })

  if (!session.url) {
    return c.json({ error: 'stripe returned no checkout url' }, 502)
  }
  return c.json({ url: session.url })
})

// --- POST /api/webhooks/stripe ---
// Verifies the Stripe-Signature header, then handles checkout.session.completed
// by upserting an entitlement row via the service-role client (bypasses RLS —
// no user JWT on the webhook request). Idempotent on (user_id) so Stripe
// retries collapse to a no-op after the first success.
api.post('/webhooks/stripe', async (c) => {
  const signature = c.req.header('stripe-signature')
  if (!signature) return c.json({ error: 'missing stripe-signature header' }, 400)

  // constructEventAsync verifies the HMAC-SHA256 signature against the raw body
  // bytes and the timestamp Stripe includes in the header. Any tampering, wrong
  // secret, or expired timestamp throws — caught below.
  const rawBody = await c.req.text()
  const stripe = stripeClient(c.env)
  let event: Stripe.Event
  try {
    event = await stripe.webhooks.constructEventAsync(
      rawBody,
      signature,
      c.env.STRIPE_WEBHOOK_SECRET,
    )
  } catch (err) {
    return c.json({ error: `signature verification failed: ${(err as Error).message}` }, 400)
  }

  if (event.type !== 'checkout.session.completed') {
    // We're only subscribed to checkout.session.completed for MVP; any other
    // event here means the endpoint config drifted. Ack so Stripe doesn't retry.
    return c.json({ received: true, note: `ignored event ${event.type}` })
  }

  const session = event.data.object
  const userId = session.metadata?.user_id
  if (!userId) {
    return c.json({ error: 'checkout session missing metadata.user_id' }, 400)
  }
  if (session.payment_status !== 'paid') {
    // async payment methods can complete-then-fail; ignore until actually paid.
    return c.json({ received: true, note: `payment_status=${session.payment_status}` })
  }

  const admin = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { error } = await admin.from('entitlements').upsert(
    {
      user_id: userId,
      type: 'lifetime',
      stripe_session_id: session.id,
      stripe_customer_id:
        typeof session.customer === 'string' ? session.customer : (session.customer?.id ?? null),
      early_adopter: true,
    },
    { onConflict: 'user_id' },
  )

  if (error) {
    // Return 500 so Stripe retries; upsert on user_id makes retries no-ops.
    return c.json({ error: error.message }, 500)
  }
  return c.json({ received: true })
})

app.route('/api', api)

// --- Static assets fallback ---
// Everything that's not /api/* falls through to the assets binding (the
// built Svelte SPA in ./dist). The assets config handles SPA fallback —
// unknown paths return index.html so client-side routing works.
app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw))

export default app

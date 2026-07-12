import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'
import Stripe from 'stripe'
import { z } from 'zod'
import {
  db,
  upsertUserByGoogleSub,
  ensureTrialState,
  getUserById,
  getEntitlement,
  getTrialState,
  insertScanLog,
  upsertEntitlement,
} from './db'
import { encryptRefreshToken, decryptRefreshToken } from './auth/crypto'
import {
  buildAuthUrl,
  callbackUrlFor,
  exchangeCode,
  parseIdToken,
  refreshAccessToken,
} from './auth/google'
import {
  issueSession,
  clearSession,
  setOAuthState,
  readOAuthState,
  clearOAuthState,
  requireSession,
} from './auth/session'

type Env = {
  DATABASE_URL: string
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
  SESSION_SIGNING_SECRET: string
  REFRESH_TOKEN_ENCRYPTION_KEY: string
  STRIPE_SECRET_KEY: string
  STRIPE_WEBHOOK_SECRET: string
  STRIPE_PRICE_ID: string
  ASSETS: { fetch: (req: Request) => Promise<Response> }
}

type Vars = {
  userId: string
}

const app = new Hono<{ Bindings: Env; Variables: Vars }>()

function stripeClient(env: Env): Stripe {
  return new Stripe(env.STRIPE_SECRET_KEY, {
    httpClient: Stripe.createFetchHttpClient(),
  })
}

const authed = createMiddleware<{ Bindings: Env; Variables: Vars }>(
  requireSession((c) => c.env.SESSION_SIGNING_SECRET),
)

const api = new Hono<{ Bindings: Env; Variables: Vars }>()

api.get('/health', (c) => c.json({ service: 'scrubinbox-api', ok: true }))

// --- OAuth flow ---

api.get('/auth/google/start', (c) => {
  const state = crypto.randomUUID()
  setOAuthState(c, state)
  const url = buildAuthUrl(c.env.GOOGLE_CLIENT_ID, callbackUrlFor(c.req.raw), state)
  return c.redirect(url, 302)
})

api.get('/auth/google/callback', async (c) => {
  const code = c.req.query('code')
  const state = c.req.query('state')
  const cookieState = readOAuthState(c)
  clearOAuthState(c)

  const oauthError = c.req.query('error')
  if (oauthError) return c.redirect(`/?auth_error=${encodeURIComponent(oauthError)}`, 302)
  if (!code || !state || !cookieState || state !== cookieState) {
    return c.redirect('/?auth_error=bad_state', 302)
  }

  let tokens
  try {
    tokens = await exchangeCode(
      c.env.GOOGLE_CLIENT_ID,
      c.env.GOOGLE_CLIENT_SECRET,
      code,
      callbackUrlFor(c.req.raw),
    )
  } catch (err) {
    return c.redirect(`/?auth_error=${encodeURIComponent(`exchange_failed: ${(err as Error).message}`)}`, 302)
  }

  const claims = parseIdToken(tokens.id_token)
  const encryptedRefreshToken = tokens.refresh_token
    ? await encryptRefreshToken(tokens.refresh_token, c.env.REFRESH_TOKEN_ENCRYPTION_KEY)
    : null

  const sql = db(c.env.DATABASE_URL)
  const user = await upsertUserByGoogleSub(sql, {
    googleSub: claims.sub,
    email: claims.email,
    encryptedRefreshToken,
  })
  await ensureTrialState(sql, user.id)

  await issueSession(c, user.id, c.env.SESSION_SIGNING_SECRET)
  return c.redirect('/', 302)
})

api.post('/auth/signout', authed, (c) => {
  clearSession(c)
  return c.json({ ok: true })
})

// --- Gmail access token ---
// Mints a fresh Google access token for the signed-in user by refreshing the
// stored refresh token. Client caches the returned expires_at and re-fetches
// when <5 min remaining. Gmail scope stays entirely client-side after this —
// we never see the email content.
api.get('/auth/gmail-token', authed, async (c) => {
  const sql = db(c.env.DATABASE_URL)
  const user = await getUserById(sql, c.var.userId)
  if (!user) return c.json({ error: 'user not found' }, 401)
  if (!user.encrypted_refresh_token) {
    return c.json({ error: 'no refresh token — please sign in again' }, 401)
  }

  const refreshToken = await decryptRefreshToken(
    user.encrypted_refresh_token,
    c.env.REFRESH_TOKEN_ENCRYPTION_KEY,
  )

  let refreshed
  try {
    refreshed = await refreshAccessToken(
      c.env.GOOGLE_CLIENT_ID,
      c.env.GOOGLE_CLIENT_SECRET,
      refreshToken,
    )
  } catch (err) {
    return c.json({ error: `refresh failed: ${(err as Error).message}` }, 502)
  }

  return c.json({
    access_token: refreshed.access_token,
    expires_at: Math.floor(Date.now() / 1000) + refreshed.expires_in,
    scope: refreshed.scope,
  })
})

// --- App API ---

api.get('/me', authed, async (c) => {
  const sql = db(c.env.DATABASE_URL)
  const [user, entitlement, trial] = await Promise.all([
    getUserById(sql, c.var.userId),
    getEntitlement(sql, c.var.userId),
    getTrialState(sql, c.var.userId),
  ])
  if (!user) return c.json({ error: 'user not found' }, 401)

  const paid =
    !!entitlement &&
    (entitlement.expires_at === null ||
      new Date(entitlement.expires_at).getTime() > Date.now())

  return c.json({
    id: user.id,
    email: user.email,
    paid,
    type: entitlement?.type ?? null,
    expires_at: entitlement?.expires_at ?? null,
    trial_used: !!trial?.trial_used_at,
  })
})

const scanLogSchema = z.object({
  threads_scanned: z.number().int().nonnegative(),
  threads_trashed: z.number().int().nonnegative(),
})

api.post('/scan-log', authed, async (c) => {
  const body = await c.req.json().catch(() => null)
  const parsed = scanLogSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'invalid body', issues: parsed.error.issues }, 400)
  }
  const sql = db(c.env.DATABASE_URL)
  await insertScanLog(sql, {
    userId: c.var.userId,
    threadsScanned: parsed.data.threads_scanned,
    threadsTrashed: parsed.data.threads_trashed,
  })
  return c.json({ ok: true }, 201)
})

api.post('/create-checkout-session', authed, async (c) => {
  const sql = db(c.env.DATABASE_URL)
  const user = await getUserById(sql, c.var.userId)
  if (!user) return c.json({ error: 'user not found' }, 401)

  const stripe = stripeClient(c.env)
  const origin = new URL(c.req.url).origin

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [{ price: c.env.STRIPE_PRICE_ID, quantity: 1 }],
    success_url: `${origin}/welcome?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/`,
    customer_email: user.email,
    customer_creation: 'always',
    metadata: { user_id: user.id },
  })

  if (!session.url) return c.json({ error: 'stripe returned no checkout url' }, 502)
  return c.json({ url: session.url })
})

// --- Stripe webhook ---
// Verifies HMAC via constructEventAsync (Workers-safe SubtleCrypto). Idempotent
// on user_id — Stripe retries collapse to no-ops.
api.post('/webhooks/stripe', async (c) => {
  const signature = c.req.header('stripe-signature')
  if (!signature) return c.json({ error: 'missing stripe-signature header' }, 400)

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
    return c.json({ received: true, note: `ignored event ${event.type}` })
  }

  const session = event.data.object
  const userId = session.metadata?.user_id
  if (!userId) return c.json({ error: 'checkout session missing metadata.user_id' }, 400)
  if (session.payment_status !== 'paid') {
    return c.json({ received: true, note: `payment_status=${session.payment_status}` })
  }

  const stripeCustomerId =
    typeof session.customer === 'string' ? session.customer : (session.customer?.id ?? null)
  if (!stripeCustomerId) {
    return c.json({ error: 'checkout session missing customer id' }, 400)
  }

  const sql = db(c.env.DATABASE_URL)
  try {
    await upsertEntitlement(sql, {
      userId,
      type: 'lifetime',
      stripeSessionId: session.id,
      stripeCustomerId,
      earlyAdopter: true,
    })
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500)
  }
  return c.json({ received: true })
})

app.route('/api', api)

// Static assets fallback: everything not /api/* hits the built Svelte SPA.
// SPA fallback (unknown paths → index.html) is configured on the assets binding.
app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw))

export default app

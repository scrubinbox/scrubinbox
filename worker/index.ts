import { Hono, type Context } from 'hono'
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
import { encryptRefreshToken } from './auth/crypto'
import {
  buildAuthUrl,
  callbackUrlFor,
  exchangeCode,
  parseIdToken,
} from './auth/google'
import {
  issueSession,
  clearSession,
  setOAuthState,
  readOAuthState,
  clearOAuthState,
  requireSession,
} from './auth/session'
import { blockLegacyMethods, securityHeaders } from './security'
import {
  GmailProxyError,
  TRASH_BATCH_SIZE,
  getGmailAccessToken,
  getInboxTotal,
  getPaidStatus,
  getScanPage,
  listLabels,
  trashThreads,
} from './gmail'

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

// TRACE/TRACK 405 short-circuit runs BEFORE securityHeaders so those
// requests never touch ASSETS or the Hono router — see worker/security.ts.
app.use('*', blockLegacyMethods())

// Apply CSP + HSTS + X-Frame-Options + friends to every response, including
// static assets served by env.ASSETS. See worker/security.ts for the policy
// rationale.
app.use('*', securityHeaders())

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
    console.error('oauth code exchange failed:', (err as Error).message)
    return c.redirect('/?auth_error=exchange_failed', 302)
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

// --- App API ---

api.get('/me', authed, async (c) => {
  const sql = db(c.env.DATABASE_URL)
  const [user, entitlement, trial] = await Promise.all([
    getUserById(sql, c.var.userId),
    getEntitlement(sql, c.var.userId),
    getTrialState(sql, c.var.userId),
  ])
  if (!user) return c.json({ error: 'user not found' }, 401)

  // Paid derivation goes through the same helper /api/trash uses so the
  // paywall trust boundary can never drift from what the client sees.
  const paid = await getPaidStatus(sql, c.var.userId)

  return c.json({
    id: user.id,
    email: user.email,
    paid,
    type: entitlement?.type ?? null,
    expires_at: entitlement?.expires_at ?? null,
    trial_used: !!trial?.trial_used_at,
  })
})

// --- Gmail proxy ---
// The Worker owns the Google access token; the client never sees one. All
// Gmail calls go through /api/labels, /api/scan/*, and /api/trash so the
// paywall enforcement lives at the trust boundary.

api.get('/labels', authed, async (c) => {
  const sql = db(c.env.DATABASE_URL)
  try {
    const accessToken = await getGmailAccessToken(c.env, sql, c.var.userId)
    const result = await listLabels(accessToken)
    return c.json({ labels: result.labels ?? [] })
  } catch (err) {
    return gmailErrorResponse(c, err)
  }
})

api.get('/scan/inbox-info', authed, async (c) => {
  const includeArchived = c.req.query('includeArchived') === 'true'
  const sql = db(c.env.DATABASE_URL)
  try {
    const accessToken = await getGmailAccessToken(c.env, sql, c.var.userId)
    const threadsTotal = await getInboxTotal(accessToken, includeArchived)
    return c.json({ threadsTotal })
  } catch (err) {
    return gmailErrorResponse(c, err)
  }
})

const scanPageSchema = z.object({
  pageToken: z.string().nullable().optional(),
  config: z.object({
    includeArchived: z.boolean().optional(),
  }).optional(),
})

api.post('/scan/page', authed, async (c) => {
  const body = await c.req.json().catch(() => null)
  const parsed = scanPageSchema.safeParse(body ?? {})
  if (!parsed.success) {
    return c.json({ error: 'invalid body', issues: parsed.error.issues }, 400)
  }
  const sql = db(c.env.DATABASE_URL)
  try {
    const accessToken = await getGmailAccessToken(c.env, sql, c.var.userId)
    const page = await getScanPage(accessToken, {
      pageToken: parsed.data.pageToken ?? null,
      includeArchived: parsed.data.config?.includeArchived ?? false,
    })
    return c.json(page)
  } catch (err) {
    return gmailErrorResponse(c, err)
  }
})

const trashSchema = z.object({
  threadIds: z.array(z.string().min(1)).min(1).max(TRASH_BATCH_SIZE),
  permanent: z.boolean().optional(),
})

api.post('/trash', authed, async (c) => {
  const body = await c.req.json().catch(() => null)
  const parsed = trashSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'invalid body', issues: parsed.error.issues }, 400)
  }
  const sql = db(c.env.DATABASE_URL)
  const paid = await getPaidStatus(sql, c.var.userId)
  if (!paid) return c.json({ error: 'not_paid' }, 403)

  try {
    const accessToken = await getGmailAccessToken(c.env, sql, c.var.userId)
    const results = await trashThreads(
      accessToken,
      parsed.data.threadIds,
      parsed.data.permanent ?? false,
    )
    return c.json({ results })
  } catch (err) {
    return gmailErrorResponse(c, err)
  }
})

function gmailErrorResponse(
  c: Context<{ Bindings: Env; Variables: Vars }>,
  err: unknown,
) {
  if (err instanceof GmailProxyError) {
    console.error(`gmail proxy ${err.code}:`, err.message)
    return c.json({ error: err.code }, err.status as 400 | 401 | 502)
  }
  console.error('gmail proxy unexpected error:', (err as Error).message)
  return c.json({ error: 'internal_error' }, 500)
}

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
    console.error('stripe webhook signature verification failed:', (err as Error).message)
    return c.json({ error: 'signature_verification_failed' }, 400)
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
    console.error('entitlement upsert failed:', (err as Error).message)
    return c.json({ error: 'entitlement_upsert_failed' }, 500)
  }
  return c.json({ received: true })
})

app.route('/api', api)

// Static assets fallback: everything not /api/* hits the built Svelte SPA.
// SPA fallback (unknown paths → index.html) is configured on the assets binding.
app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw))

export default app

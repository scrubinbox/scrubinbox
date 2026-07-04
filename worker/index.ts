import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js'
import { z } from 'zod'

type Env = {
  SUPABASE_URL: string
  SUPABASE_ANON_KEY: string
  SUPABASE_SERVICE_ROLE_KEY: string
  LEMONSQUEEZY_WEBHOOK_SECRET: string
  ASSETS: { fetch: (req: Request) => Promise<Response> }
}

type AuthedVars = {
  user: User
  supabase: SupabaseClient
}

const app = new Hono<{ Bindings: Env; Variables: AuthedVars }>()

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

// --- Webhooks ---
// Stub: Phase 5 implements HMAC verification + entitlement upsert via the
// service-role client. Returning 501 so misrouted production traffic fails
// loudly rather than silently dropping order events.
api.post('/webhooks/lemonsqueezy', (c) => {
  return c.json({ error: 'not implemented — Phase 5' }, 501)
})

app.route('/api', api)

// --- Static assets fallback ---
// Everything that's not /api/* falls through to the assets binding (the
// built Svelte SPA in ./dist). The assets config handles SPA fallback —
// unknown paths return index.html so client-side routing works.
app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw))

export default app

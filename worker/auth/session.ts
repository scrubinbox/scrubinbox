import type { Context, MiddlewareHandler } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { signSession, verifySession, SESSION_TTL } from './jwt'

export const SESSION_COOKIE = 'sb_session'
export const OAUTH_STATE_COOKIE = 'oauth_state'

const OAUTH_STATE_TTL = 600

type CookieOpts = Parameters<typeof setCookie>[3]

function baseCookieOpts(): CookieOpts {
  return {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/',
  }
}

export async function issueSession(
  c: Context,
  userId: string,
  signingSecret: string,
): Promise<void> {
  const token = await signSession(userId, signingSecret)
  setCookie(c, SESSION_COOKIE, token, {
    ...baseCookieOpts(),
    maxAge: SESSION_TTL,
  })
}

export function clearSession(c: Context): void {
  deleteCookie(c, SESSION_COOKIE, { path: '/' })
}

export function setOAuthState(c: Context, state: string): void {
  setCookie(c, OAUTH_STATE_COOKIE, state, {
    ...baseCookieOpts(),
    maxAge: OAUTH_STATE_TTL,
  })
}

export function readOAuthState(c: Context): string | undefined {
  return getCookie(c, OAUTH_STATE_COOKIE)
}

export function clearOAuthState(c: Context): void {
  deleteCookie(c, OAUTH_STATE_COOKIE, { path: '/' })
}

export function readSessionCookie(c: Context): string | undefined {
  return getCookie(c, SESSION_COOKIE)
}

export function requireSession(signingSecret: (c: Context) => string): MiddlewareHandler {
  return async (c, next) => {
    const token = readSessionCookie(c)
    if (!token) return c.json({ error: 'not signed in' }, 401)
    const userId = await verifySession(token, signingSecret(c))
    if (!userId) return c.json({ error: 'invalid or expired session' }, 401)
    c.set('userId', userId)
    await next()
  }
}

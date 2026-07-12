// Google OAuth 2.0 authorization-code flow.
//
// We are a confidential client (client_secret in Worker env), so PKCE is
// optional per RFC 6749; skipping it. State is a random cookie value the
// callback compares against Google's echoed `state` param for CSRF.

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'

const SCOPES = ['openid', 'email', 'profile', 'https://mail.google.com/'].join(' ')

export function buildAuthUrl(clientId: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  })
  return `${AUTH_ENDPOINT}?${params.toString()}`
}

export type TokenResponse = {
  access_token: string
  refresh_token?: string
  expires_in: number
  id_token: string
  scope: string
  token_type: string
}

export async function exchangeCode(
  clientId: string,
  clientSecret: string,
  code: string,
  redirectUri: string,
): Promise<TokenResponse> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`google token exchange failed: ${res.status} ${text}`)
  }
  return res.json() as Promise<TokenResponse>
}

export type RefreshResponse = {
  access_token: string
  expires_in: number
  scope: string
  token_type: string
}

export async function refreshAccessToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
): Promise<RefreshResponse> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`google token refresh failed: ${res.status} ${text}`)
  }
  return res.json() as Promise<RefreshResponse>
}

export type IdTokenClaims = {
  sub: string
  email: string
  email_verified?: boolean
  name?: string
  picture?: string
}

// id_token is a JWT signed by Google. We trust the payload because it came
// from the direct token-endpoint response over HTTPS with our client_secret —
// verifying the signature adds no security here (RFC 6749 §10.12) since the
// TLS-authenticated channel already binds the response to us.
export function parseIdToken(idToken: string): IdTokenClaims {
  const parts = idToken.split('.')
  if (parts.length !== 3) throw new Error('malformed id_token')
  const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
  const json = atob(padded)
  const claims = JSON.parse(json)
  if (typeof claims.sub !== 'string' || typeof claims.email !== 'string') {
    throw new Error('id_token missing sub or email')
  }
  return claims as IdTokenClaims
}

export function callbackUrlFor(request: Request): string {
  return new URL('/api/auth/google/callback', request.url).toString()
}

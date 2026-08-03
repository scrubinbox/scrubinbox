import { SignJWT, jwtVerify } from 'jose'

// 24 hours. The session JWT is stateless (no server-side revocation store)
// so per OWASP ASVS L1 2.2.3 / CASA AL1 SAQ, its TTL must not exceed 24h.
// If we later add server-side revocation (a sessions table in Neon, checked
// per request), the requirement no longer applies and we can extend this.
const SESSION_TTL_SECONDS = 24 * 60 * 60

function keyFromSecret(secret: string): Uint8Array {
  return new TextEncoder().encode(secret)
}

export async function signSession(userId: string, secret: string): Promise<string> {
  return new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(keyFromSecret(secret))
}

export async function verifySession(token: string, secret: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, keyFromSecret(secret), {
      algorithms: ['HS256'],
    })
    return typeof payload.sub === 'string' ? payload.sub : null
  } catch {
    return null
  }
}

export const SESSION_TTL = SESSION_TTL_SECONDS

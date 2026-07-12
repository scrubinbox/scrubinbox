import { SignJWT, jwtVerify } from 'jose'

const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60

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

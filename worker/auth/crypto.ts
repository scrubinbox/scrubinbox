// AES-GCM encryption for OAuth refresh tokens at rest in Neon.
// Ciphertext format: iv (12 bytes) || aes-gcm-ciphertext (includes auth tag).
// Key is a base64-encoded 32-byte value in REFRESH_TOKEN_ENCRYPTION_KEY.

const IV_LENGTH = 12

function decodeBase64Key(base64Key: string): Uint8Array {
  const binary = atob(base64Key)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  if (bytes.length !== 32) {
    throw new Error(`REFRESH_TOKEN_ENCRYPTION_KEY must decode to 32 bytes, got ${bytes.length}`)
  }
  return bytes
}

async function importKey(base64Key: string): Promise<CryptoKey> {
  const raw = decodeBase64Key(base64Key)
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

export async function encryptRefreshToken(
  plaintext: string,
  base64Key: string,
): Promise<Uint8Array> {
  const key = await importKey(base64Key)
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH))
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext)),
  )
  const out = new Uint8Array(IV_LENGTH + ciphertext.byteLength)
  out.set(iv, 0)
  out.set(ciphertext, IV_LENGTH)
  return out
}

export async function decryptRefreshToken(
  payload: Uint8Array,
  base64Key: string,
): Promise<string> {
  if (payload.byteLength <= IV_LENGTH) {
    throw new Error('encrypted refresh token payload is truncated')
  }
  const key = await importKey(base64Key)
  const iv = payload.slice(0, IV_LENGTH)
  const ciphertext = payload.slice(IV_LENGTH)
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext)
  return new TextDecoder().decode(plaintext)
}

/**
 * Thin client for the ScrubInbox Worker API.
 *
 * Session is a Worker-issued HS256 JWT stored in an httpOnly cookie set at
 * /api/auth/google/callback. The browser attaches it automatically on
 * same-origin requests; nothing to add here.
 */

const API_BASE = '/api';

async function request(path, init = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(init.headers ?? {}),
  };
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
    credentials: 'same-origin',
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`API ${path} ${res.status}: ${body}`);
  }
  return res.status === 204 ? null : res.json();
}

/**
 * Returns { id, email, paid, type, expires_at, trial_used }, or null if the
 * caller is not signed in. Only distinguishes "not signed in" from other
 * failures — auth cookie missing / expired both surface as null.
 */
export async function getMe() {
  try {
    return await request('/me');
  } catch (err) {
    if (/ 401:/.test(err.message)) return null;
    throw err;
  }
}

export function postScanLog({ threads_scanned, threads_trashed }) {
  return request('/scan-log', {
    method: 'POST',
    body: JSON.stringify({ threads_scanned, threads_trashed }),
  });
}

export function createCheckoutSession() {
  return request('/create-checkout-session', { method: 'POST' });
}

export function signOut() {
  return request('/auth/signout', { method: 'POST' });
}

/**
 * Mints a fresh Google access token for Gmail API calls, refreshed by the
 * Worker from the encrypted refresh token in Neon. Returns
 * { access_token, expires_at (unix seconds), scope }.
 */
export function getGmailToken() {
  return request('/auth/gmail-token');
}

/**
 * Gmail auth bridge: our Worker mints Google access tokens from encrypted
 * refresh tokens stored in Neon. We push them into gapi.client so all existing
 * Gmail API calls keep working unchanged.
 *
 * Access-token lifecycle:
 *   - Access tokens last ~1 hour. `ensureGmailToken()` fetches a fresh one from
 *     the Worker and caches it in memory (`token` + `expiresAt`) so scans don't
 *     round-trip through the Worker on every call.
 *   - `refreshGoogleAccessToken()` forces a re-fetch. Used as the 401 recovery
 *     path in `../api.js` (Gmail wrapper).
 *   - `signOut()` clears the gapi token and calls the Worker to drop the session
 *     cookie.
 */

import { getGmailToken, signOut as apiSignOut } from '../api.js';

const DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/apis/gmail/v1/rest';
const REFRESH_MARGIN_SECONDS = 5 * 60;

let gapiInited = false;
let cachedToken = null;
let cachedExpiresAt = 0;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
    document.head.appendChild(script);
  });
}

function waitForGlobal(name, timeout = 10000) {
  return new Promise((resolve, reject) => {
    if (window[name]) {
      resolve(window[name]);
      return;
    }
    const start = Date.now();
    const interval = setInterval(() => {
      if (window[name]) {
        clearInterval(interval);
        resolve(window[name]);
      } else if (Date.now() - start > timeout) {
        clearInterval(interval);
        reject(new Error(`Timeout waiting for ${name} to load`));
      }
    }, 50);
  });
}

/**
 * Load gapi.client (no GIS — Google consent runs through our Worker OAuth flow).
 * Resolves when gapi.client.gmail is ready for use.
 */
export async function initGoogleLibraries() {
  if (gapiInited) return;
  await loadScript('https://apis.google.com/js/api.js');
  await waitForGlobal('gapi');
  await new Promise((resolve) => gapi.load('client', resolve));
  await gapi.client.init({ discoveryDocs: [DISCOVERY_DOC] });
  gapiInited = true;
}

function tokenIsFresh() {
  return !!cachedToken && Date.now() / 1000 < cachedExpiresAt - REFRESH_MARGIN_SECONDS;
}

/**
 * Ensure gapi has a fresh Google access token. Fetches from the Worker if the
 * cached token is stale or missing. Returns true if a token is attached.
 */
export async function ensureGmailToken() {
  if (tokenIsFresh() && gapi.client.getToken()) return true;
  const { access_token, expires_at } = await getGmailToken();
  cachedToken = access_token;
  cachedExpiresAt = expires_at;
  gapi.client.setToken({ access_token });
  return true;
}

/**
 * Force a new access token from the Worker. Used as the 401 recovery path.
 */
export async function refreshGoogleAccessToken() {
  cachedToken = null;
  await ensureGmailToken();
}

/**
 * Sign out: clear our session cookie via the Worker, clear the local gapi
 * token, drop the in-memory access token cache.
 */
export async function signOut() {
  try {
    await apiSignOut();
  } finally {
    cachedToken = null;
    cachedExpiresAt = 0;
    if (gapiInited && gapi.client.getToken()) {
      gapi.client.setToken(null);
    }
  }
}

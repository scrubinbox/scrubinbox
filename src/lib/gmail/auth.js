/**
 * Gmail auth bridge: Supabase mediates OAuth, we use the resulting
 * provider_token (Google access token) with gapi.client to call the Gmail API.
 *
 * Flow:
 *   1. App calls signIn() → supabase.auth.signInWithOAuth → browser redirects
 *      through Supabase → Google → Supabase → back here with ?code=
 *   2. supabase.auth.detectSessionInUrl (configured in client.js) exchanges
 *      the code for a session whose `provider_token` is the Google access token.
 *   3. attachSessionToGapi() pushes provider_token into gapi.client so all
 *      existing Gmail API calls in api.js keep working unchanged.
 *   4. On 401, refreshGoogleAccessToken() asks Supabase to refresh the session,
 *      which also refreshes provider_token via the stored Google refresh token.
 */

import { supabase } from '../supabase/client.js';

const DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/apis/gmail/v1/rest';
const GMAIL_SCOPE = 'https://mail.google.com/';

let gapiInited = false;

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
 * Load gapi.client (no GIS — Supabase handles consent).
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

/**
 * If a Supabase session already exists with a provider_token, set it on
 * gapi.client so Gmail calls work. Returns true if a token was attached.
 */
export async function attachSessionToGapi() {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.provider_token;
  if (!token) {
    gapi.client.setToken(null);
    return false;
  }
  gapi.client.setToken({ access_token: token });
  return true;
}

/**
 * Kick off the OAuth flow. Browser navigates away; on return,
 * detectSessionInUrl handles the code exchange.
 */
export async function signIn() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      scopes: GMAIL_SCOPE,
      // access_type=offline + prompt=consent ensures we get a refresh_token
      // even on returning sign-ins, so silent provider_token refresh works.
      queryParams: { access_type: 'offline', prompt: 'consent' },
      redirectTo: window.location.origin,
    },
  });
  if (error) throw error;
}

/**
 * Refresh the Supabase session, which also refreshes provider_token using
 * the stored Google refresh token. Pushes the new token into gapi.client.
 * Used as the 401 recovery path in api.js.
 */
export async function refreshGoogleAccessToken() {
  const { data, error } = await supabase.auth.refreshSession();
  if (error || !data.session?.provider_token) {
    throw new Error('failed to refresh google access token');
  }
  gapi.client.setToken({ access_token: data.session.provider_token });
}

/**
 * Sign out of Supabase and clear the gapi token.
 */
export async function signOut() {
  await supabase.auth.signOut();
  if (gapiInited && gapi.client.getToken()) {
    gapi.client.setToken(null);
  }
}

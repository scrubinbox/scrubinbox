/**
 * Gmail API wrapper — talks to our Worker proxy, not Google directly.
 *
 * The Worker owns the Google access token; this module just POSTs the
 * shape the endpoints expect and returns the projected data. Session
 * auth rides on the sb_session cookie set at OAuth callback.
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
    let bodyJson = null;
    try {
      bodyJson = await res.json();
    } catch {
      // non-JSON error body — surface the raw text below
    }
    const err = new Error(
      `API ${path} ${res.status}: ${bodyJson?.error ?? '(no body)'}`,
    );
    err.status = res.status;
    err.code = bodyJson?.error ?? null;
    throw err;
  }
  return res.status === 204 ? null : res.json();
}

/**
 * List the signed-in user's Gmail labels. Returns { labels: [{id, name, type, ...}] }.
 */
export function listLabels() {
  return request('/labels');
}

/**
 * Total scannable-thread count for progress display.
 * Returns { threadsTotal }.
 */
export function getInboxInfo(includeArchived = false) {
  const qs = includeArchived ? '?includeArchived=true' : '';
  return request(`/scan/inbox-info${qs}`);
}

/**
 * Fetch one page of thread metadata. Worker returns up to 49 projected
 * threads plus a nextPageToken for the next call.
 *
 * @param {object} args
 * @param {string|null} args.pageToken
 * @param {{includeArchived: boolean}} args.config
 * @returns {Promise<{threads: Array<{id, from, subject, labelIds, messageCount}>, nextPageToken: string|null}>}
 */
export function fetchScanPage({ pageToken = null, config }) {
  return request('/scan/page', {
    method: 'POST',
    body: JSON.stringify({ pageToken, config }),
  });
}

/**
 * Trash (or permanently delete) a batch of threads server-side. The Worker
 * enforces the paywall here — non-paid users get HTTP 403.
 *
 * @param {string[]} threadIds  Max 49 per call.
 * @param {boolean} permanent
 * @returns {Promise<{results: Array<{id, success, error?}>}>}
 */
export function trashBatch(threadIds, permanent = false) {
  return request('/trash', {
    method: 'POST',
    body: JSON.stringify({ threadIds, permanent }),
  });
}

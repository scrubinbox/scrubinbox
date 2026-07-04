/**
 * Thin client for the ScrubInbox Worker API.
 *
 * Attaches the user's Supabase JWT as a Bearer token; the Worker validates
 * the token via supabase.auth.getUser(jwt) and uses the same JWT for
 * RLS-scoped queries on the user's behalf.
 */

import { supabase } from './client.js';

// Same-origin: the production Worker serves both the SPA and the /api/*
// routes, and Vite proxies /api/* to the local Worker in dev. No env var
// needed — '/api' is correct everywhere.
const API_BASE = '/api';

async function authHeader() {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('not authenticated');
  return { Authorization: `Bearer ${token}` };
}

async function request(path, init = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(await authHeader()),
    ...(init.headers ?? {}),
  };
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`API ${path} ${res.status}: ${body}`);
  }
  return res.status === 204 ? null : res.json();
}

/**
 * Returns { paid, type, expires_at, trial_used }.
 */
export function getMe() {
  return request('/me');
}

/**
 * Logs a completed scan. threads_trashed is the count actually
 * deleted/trashed (zero for scan-only).
 */
export function postScanLog({ threads_scanned, threads_trashed }) {
  return request('/scan-log', {
    method: 'POST',
    body: JSON.stringify({ threads_scanned, threads_trashed }),
  });
}

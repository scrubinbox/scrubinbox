/**
 * Scan-state persistence across the Stripe checkout round-trip (and page
 * reloads within the same tab).
 *
 * We use sessionStorage — per-tab, per-origin, survives cross-origin
 * navigation, cleared when the tab closes. That's exactly the lifecycle we
 * want: the user can pay and come back to intact scan results, but a fresh
 * tab hours later starts clean rather than showing stale data.
 *
 * Email content itself is not scanned or stored — Gmail's threads.get with
 * format='metadata' returns headers only. sessionStorage keeps that metadata
 * on the user's own machine, never sent to our servers. Consistent with the
 * "email content never leaves your browser" architectural principle.
 */

import { CollectionResult } from './models/index.js';

const KEY = 'scrubinbox:lastScan';

/**
 * Snapshot the current scan + selection state into sessionStorage.
 *
 * @param {object} args
 * @param {CollectionResult} args.collectionResult
 * @param {object} args.domains          Sorted domain map (as $domains store holds it)
 * @param {Set<string>} args.selectedThreadIds
 * @param {Set<string>} args.expandedDomains
 * @param {string} args.userId           Signed-in user's Supabase id — used
 *                                       on restore to guard against showing
 *                                       data from a different account.
 */
export function saveScanState({
  collectionResult,
  domains,
  selectedThreadIds,
  expandedDomains,
  userId,
}) {
  try {
    const payload = {
      version: 1,
      savedAt: Date.now(),
      userId,
      collectionResult: collectionResult.toJSON(),
      domains,
      selectedThreadIds: [...selectedThreadIds],
      expandedDomains: [...expandedDomains],
    };
    sessionStorage.setItem(KEY, JSON.stringify(payload));
  } catch (err) {
    // QuotaExceededError (~5 MB limit) is the common case for very large
    // inboxes. Silent degradation is the right call — the user still has
    // their results in-memory and can pay & rescan if state was lost.
    console.warn('scrubinbox: could not persist scan state:', err);
  }
}

/**
 * Load a previously persisted scan snapshot.
 *
 * Returns null if nothing is stored, the payload is malformed, or the
 * schema version doesn't match. Callers should also validate that
 * `userId` matches the currently-signed-in user before hydrating stores.
 */
export function loadScanState() {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed.version !== 1) return null;
    return {
      savedAt: parsed.savedAt,
      userId: parsed.userId,
      collectionResult: CollectionResult.fromJSON(parsed.collectionResult),
      domains: parsed.domains,
      selectedThreadIds: new Set(parsed.selectedThreadIds),
      expandedDomains: new Set(parsed.expandedDomains),
    };
  } catch (err) {
    console.warn('scrubinbox: could not load scan state:', err);
    return null;
  }
}

export function clearScanState() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // ignore — no-op is fine
  }
}

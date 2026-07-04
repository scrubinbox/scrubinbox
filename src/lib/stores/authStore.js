import { writable } from 'svelte/store';

export const isAuthenticated = writable(false);
export const userEmail = writable('');

/**
 * Entitlement state, sourced from GET /me.
 *
 *   paid       true when the user has an active entitlement row.
 *   loaded     true once /me has been called at least once for this session;
 *              gates UI so we don't flash the paywall before we know.
 */
export const isPaid = writable(false);
export const entitlementLoaded = writable(false);

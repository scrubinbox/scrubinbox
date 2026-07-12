/**
 * Sign-in trigger: a top-level navigation to the Worker's OAuth start endpoint.
 *
 * The Worker sets a state cookie, redirects to Google, receives the callback,
 * upserts the user, sets the session cookie, and redirects the browser back to
 * `/`. From the client's perspective this function never returns — the page
 * navigates away.
 */
export function signIn() {
  window.location.href = '/api/auth/google/start';
}

import type { MiddlewareHandler } from 'hono'

// Content Security Policy for both the SPA and /api/* responses.
//
// Directive rationale:
// - script-src: 'self' for our SPA bundle. static.cloudflareinsights.com
//   serves the Cloudflare Web Analytics beacon, injected by CF on every
//   page. No third-party script hosts — gapi.client was removed when
//   Gmail API calls moved to the Worker.
// - style-src: 'self' for the built bundle. 'unsafe-inline' is required
//   for one dynamic style="width: {N}%" in ProgressSection.svelte (progress
//   bar); tighter alternatives (CSS custom property) are a refactor for
//   another day.
// - font-src: 'self' — Instrument Sans is self-hosted via Fontsource
//   (@fontsource/instrument-sans in src/app.css), bundled into /assets/
//   by Vite.
// - connect-src: 'self' covers all /api/* traffic — Gmail calls are proxied
//   through the Worker so the browser never speaks to *.googleapis.com
//   anymore. accounts.google.com is only visited via full-page redirect
//   for OAuth (top-level navigation, not fetch), so no allowance needed.
//   cloudflareinsights.com is the beacon endpoint for CF Web Analytics.
// - frame-src: no third-party frames used anywhere.
//
// - frame-ancestors 'none' + X-Frame-Options: DENY: clickjacking defense.
// - form-action 'self': block any embedded form from POSTing off-origin.
// - object-src 'none': no plugins, ever.
// - base-uri 'self': prevent <base> tag hijacking.
const CSP = [
  "default-src 'self'",
  "script-src 'self' https://static.cloudflareinsights.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self' https://cloudflareinsights.com",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ')

const HEADERS: Record<string, string> = {
  'Content-Security-Policy': CSP,
  // Two years, subdomains, submit to browser preload lists.
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  // Same-origin blocks cross-origin fetches from reading our responses,
  // hardening against Spectre-class side-channel attacks.
  'Cross-Origin-Resource-Policy': 'same-origin',
  // Isolates our top-level browsing context from cross-origin popups.
  // Safe for our flow: we do full-page OAuth redirect (no popups), gapi's
  // token bridge is an iframe (COOP only applies to top-level windows).
  // 'same-origin-allow-popups' is weaker per TAC's remedy.
  'Cross-Origin-Opener-Policy': 'same-origin',
  // Deny features we don't use. (FLoC's `interest-cohort` token was removed
  // when Chrome killed FLoC in 2023; keeping it produces a console warning
  // on every page load with no security benefit.)
  'Permissions-Policy':
    'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
}

// Reject TRACE and TRACK explicitly. These legacy HTTP methods are never
// used by browsers, and their responses reveal proxy/server topology,
// which triggered the "Proxy Disclosure" finding in the TAC revalidation
// scan. Returning 405 early — before ASSETS or any Hono handler — means
// the response body carries no fingerprint. `Allow` lists only the
// methods our public surface actually accepts.
export function blockLegacyMethods(): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.method === 'TRACE' || c.req.method === 'TRACK') {
      return c.text('Method Not Allowed', 405, { Allow: 'GET, POST' })
    }
    await next()
  }
}

// Cache-Control policy by response type.
//
// The Cloudflare Workers ASSETS binding defaults every static file to
// `public, max-age=0, must-revalidate`, and Hono JSON handlers set no
// Cache-Control at all. Both are wrong for different reasons: the assets
// default keeps hashed JS/CSS bundles from being cached at all (defeating
// the whole point of content-hashed filenames), and no header on an API
// response means intermediate caches decide for themselves.
//
// Policy:
// - /api/* — user data (session state, entitlements, Gmail tokens). Must
//   never be cached anywhere. Even a shared cache holding the response for
//   milliseconds could serve it to the wrong user on a subsequent hit.
// - /assets/* — Vite output. Filenames are content-hashed (e.g.
//   `index-ClVo4JdV.js`), so the file at that URL never changes; cache
//   forever with `immutable` so browsers don't send If-None-Match.
// - /favicon/* — icons. Not hashed, so short cache; 1 day is fine.
// - /robots.txt, /sitemap.xml — public metadata. 1 hour cache.
// - Everything else (HTML entry points like /, /welcome, /purchase) —
//   `no-cache, must-revalidate` so browsers re-check on every navigation;
//   the served HTML embeds asset URLs that must reflect the current deploy.
function cacheControlFor(path: string): string {
  if (path.startsWith('/api/')) return 'no-store'
  if (path.startsWith('/assets/')) return 'public, max-age=31536000, immutable'
  if (path.startsWith('/favicon/')) return 'public, max-age=86400'
  if (path === '/robots.txt' || path === '/sitemap.xml') return 'public, max-age=3600'
  return 'no-cache, must-revalidate'
}

// Applies our security response headers to every response, whether it came
// from a Hono handler or the static assets binding. Because Cloudflare's
// asset-binding responses can carry an immutable Headers object, we
// reconstruct the response before writing our headers — writing directly
// into an immutable header set throws silently under wrangler and produces
// missing headers in prod.
export function securityHeaders(): MiddlewareHandler {
  return async (c, next) => {
    await next()
    const original = c.res
    const merged = new Headers(original.headers)
    for (const [name, value] of Object.entries(HEADERS)) {
      merged.set(name, value)
    }
    merged.set('Cache-Control', cacheControlFor(new URL(c.req.url).pathname))
    c.res = new Response(original.body, {
      status: original.status,
      statusText: original.statusText,
      headers: merged,
    })
  }
}

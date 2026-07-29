import type { MiddlewareHandler } from 'hono'

// Content Security Policy for both the SPA and /api/* responses.
//
// Directive rationale:
// - script-src: 'self' for our SPA bundle + apis.google.com for gapi.client
//   which we load dynamically in src/lib/gmail/auth.js. static.cloudflareinsights.com
//   serves the Cloudflare Web Analytics beacon, injected by CF on every page.
// - style-src: 'self' for the built bundle + fonts.googleapis.com for the
//   Instrument Sans stylesheet linked in index.html. 'unsafe-inline' is
//   required for one dynamic style="width: {N}%" in ProgressSection.svelte
//   (progress bar); tighter alternatives (CSS custom property) are a
//   refactor for another day.
// - font-src: fonts.gstatic.com serves the font files themselves.
// - connect-src / frame-src: wildcards cover Google's operational domains.
//   *.googleapis.com covers the API surface (gmail, www, content-<svc>,
//   etc.). *.google.com covers ancillary hosts gapi + GIS libraries reach
//   for telemetry (apis.google.com/js/gen_204), identity/consent
//   (accounts.google.com), and other Google-operated properties. We use
//   wildcards rather than an explicit host list because the previous list
//   broke on every new Google subdomain we didn't know about, and Google
//   is a single trusted vendor for these directives — the trust boundary
//   is the same either way.
//   Own origin covers /api/*. cloudflareinsights.com is the beacon endpoint
//   for CF Web Analytics.
//
// script-src stays STRICT (explicit hosts, no wildcards) — that's the
// directive where XSS lives, and the load-time hosts genuinely don't
// change often.
// - frame-ancestors 'none' + X-Frame-Options: DENY: clickjacking defense.
// - form-action 'self': block any embedded form from POSTing off-origin.
// - object-src 'none': no plugins, ever.
// - base-uri 'self': prevent <base> tag hijacking.
const CSP = [
  "default-src 'self'",
  "script-src 'self' https://apis.google.com https://static.cloudflareinsights.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data:",
  "font-src 'self' https://fonts.gstatic.com",
  "connect-src 'self' https://*.googleapis.com https://*.google.com https://cloudflareinsights.com",
  "frame-src https://*.googleapis.com https://*.google.com",
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
  // Deny features we don't use. (FLoC's `interest-cohort` token was removed
  // when Chrome killed FLoC in 2023; keeping it produces a console warning
  // on every page load with no security benefit.)
  'Permissions-Policy':
    'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
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
    const cc = cacheControlFor(new URL(c.req.url).pathname)
    merged.set('Cache-Control', cc)
    merged.set('X-Debug-CC', cc)
    merged.set('X-Debug-Path', new URL(c.req.url).pathname)
    c.res = new Response(original.body, {
      status: original.status,
      statusText: original.statusText,
      headers: merged,
    })
  }
}

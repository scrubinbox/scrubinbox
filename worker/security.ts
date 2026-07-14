import type { MiddlewareHandler } from 'hono'

// Content Security Policy for both the SPA and /api/* responses.
//
// Directive rationale (see docs/casa/asvs-l1-self-assessment.md V9.2):
// - script-src: 'self' for our SPA bundle + apis.google.com for gapi.client
//   which we load dynamically in src/lib/gmail/auth.js.
// - style-src: 'self' for the built bundle + fonts.googleapis.com for the
//   Instrument Sans stylesheet linked in index.html. 'unsafe-inline' is
//   required for one dynamic style="width: {N}%" in ProgressSection.svelte
//   (progress bar); tighter alternatives (CSS custom property) are a
//   refactor for another day.
// - font-src: fonts.gstatic.com serves the font files themselves.
// - connect-src: gmail.googleapis.com for direct client→Gmail API calls
//   (email content never traverses our servers, per principle #1) plus
//   www.googleapis.com for gapi's discovery-doc fetch. Own origin covers
//   /api/*.
// - frame-ancestors 'none' + X-Frame-Options: DENY: clickjacking defense.
// - form-action 'self': block any embedded form from POSTing off-origin.
// - object-src 'none': no plugins, ever.
// - base-uri 'self': prevent <base> tag hijacking.
const CSP = [
  "default-src 'self'",
  "script-src 'self' https://apis.google.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data:",
  "font-src 'self' https://fonts.gstatic.com",
  "connect-src 'self' https://gmail.googleapis.com https://www.googleapis.com",
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
  // Deny features we don't use. interest-cohort opts us out of Google FLoC.
  'Permissions-Policy':
    'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
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
    c.res = new Response(original.body, {
      status: original.status,
      statusText: original.statusText,
      headers: merged,
    })
  }
}

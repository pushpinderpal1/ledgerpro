import { NextResponse } from 'next/server'

/**
 * Production-grade security headers. Applied to every response in middleware.
 *
 * Notes:
 *  - CSP intentionally permits inline styles because page.tsx uses inline styles
 *    pervasively. Once styles are extracted to CSS modules, tighten this.
 *  - HSTS only emitted in production (would break local dev over http).
 */
export function applySecurityHeaders(res: NextResponse): NextResponse {
  const isProd = process.env.NODE_ENV === 'production'

  res.headers.set(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",  // Next.js needs eval in some configs
      "style-src 'self' 'unsafe-inline'",                  // inline styles in page.tsx
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join('; ')
  )
  res.headers.set('X-Content-Type-Options', 'nosniff')
  res.headers.set('X-Frame-Options', 'DENY')
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()')
  res.headers.set('X-DNS-Prefetch-Control', 'off')

  if (isProd) {
    res.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload')
  }
  return res
}

/**
 * Origin/Referer check for mutating requests. Lightweight CSRF defense that
 * works without per-request tokens. Combined with SameSite=strict cookies this
 * is solid for a same-origin SPA.
 */
export function originAllowed(req: Request): boolean {
  const method = req.method.toUpperCase()
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return true

  const origin = req.headers.get('origin')
  const referer = req.headers.get('referer')
  const host = req.headers.get('host')
  if (!host) return false

  const expected = new Set<string>()
  // Allow current host (both http & https).
  expected.add(`https://${host}`)
  expected.add(`http://${host}`)
  // Allow extra trusted origins from env (comma-separated).
  const trusted = process.env.TRUSTED_ORIGINS
  if (trusted) for (const t of trusted.split(',')) expected.add(t.trim())

  if (origin) return expected.has(origin)
  if (referer) {
    try {
      const r = new URL(referer)
      return expected.has(`${r.protocol}//${r.host}`)
    } catch {
      return false
    }
  }
  // No origin/referer on a mutating request — reject.
  return false
}

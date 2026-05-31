import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'
import { applySecurityHeaders, originAllowed } from '@/lib/security/headers'

const PUBLIC_PATHS = [
  '/', '/api/auth/login', '/api/auth/register', '/api/health',
  '/_next', '/favicon.ico',
]

// Strict-cookie + same-origin SPA needs an Origin check on state-changing
// requests as a defense against CSRF.
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // CSRF / origin protection for mutating API requests.
  if (pathname.startsWith('/api/') && MUTATING.has(req.method)) {
    if (!originAllowed(req)) {
      const res = NextResponse.json(
        { error: 'Cross-origin request blocked' },
        { status: 403 }
      )
      return applySecurityHeaders(res)
    }
  }

  // Public paths don't need a session.
  if (PUBLIC_PATHS.some(p => pathname.startsWith(p))) {
    return applySecurityHeaders(NextResponse.next())
  }

  const token = req.cookies.get('ledgerpro_session')?.value
  if (!token) {
    if (pathname.startsWith('/api/')) {
      return applySecurityHeaders(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    }
    return applySecurityHeaders(NextResponse.redirect(new URL('/', req.url)))
  }

  const session = await verifyToken(token)
  if (!session) {
    if (pathname.startsWith('/api/')) {
      return applySecurityHeaders(NextResponse.json({ error: 'Session expired' }, { status: 401 }))
    }
    const res = NextResponse.redirect(new URL('/', req.url))
    res.cookies.delete('ledgerpro_session')
    return applySecurityHeaders(res)
  }

  const res = NextResponse.next()
  res.headers.set('x-user-id', session.userId)
  res.headers.set('x-user-email', session.email)
  res.headers.set('x-is-super-admin', String(session.isSuperAdmin))
  return applySecurityHeaders(res)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}

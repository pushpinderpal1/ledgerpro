import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import {
  signToken,
  setSessionCookie,
  verifyChallengeToken,
} from '@/lib/auth'
import { decrypt } from '@/lib/security/encryption'
import { verifyTotp } from '@/lib/security/totp'
import { consumeBackupCode } from '@/lib/security/backup-codes'
import { checkRateLimit, recordFailure, clearFailures, clientKey } from '@/lib/security/rate-limit'

const schema = z.object({
  challengeToken: z.string().min(20),
  code: z.string().min(6).max(20),                   // TOTP (6) or backup code (10-11)
})

/**
 * POST /api/auth/2fa/challenge
 *
 * Second step of a 2FA-enabled login. The client posts the challenge token
 * returned by /login plus either:
 *  - a 6-digit TOTP code from the authenticator, OR
 *  - a one-time backup code
 *
 * On success the real session cookie is set and the challenge token discarded.
 * Per-(IP, user) rate limit applies to defeat code guessing.
 */
export async function POST(req: NextRequest) {
  try {
    const { challengeToken, code } = schema.parse(await req.json())

    const challenge = await verifyChallengeToken(challengeToken)
    if (!challenge) {
      return NextResponse.json({ error: 'Challenge expired. Sign in again.' }, { status: 401 })
    }

    const rlKey = clientKey(req, `2fa:${challenge.userId}`)
    const limit = checkRateLimit(rlKey, { shortMax: 5, longMax: 20 })
    if (!limit.allowed) {
      return NextResponse.json(
        { error: 'Too many attempts. Please try again later.' },
        { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } }
      )
    }

    const user = await db.user.findUnique({ where: { id: challenge.userId } })
    if (!user || !user.isActive || !user.totpEnabled || !user.totpSecret) {
      recordFailure(rlKey)
      return NextResponse.json({ error: 'Invalid state' }, { status: 401 })
    }

    // Try TOTP first (6 digits), then fall back to backup code (10–11 chars).
    let ok = false
    const cleanCode = code.replace(/\s+/g, '')
    if (/^\d{6}$/.test(cleanCode)) {
      const secret = decrypt(user.totpSecret)
      ok = verifyTotp(secret, cleanCode)
    }
    if (!ok) {
      ok = await consumeBackupCode(user.id, code)
    }

    if (!ok) {
      recordFailure(rlKey)
      return NextResponse.json({ error: 'Invalid code' }, { status: 401 })
    }

    clearFailures(rlKey)

    await db.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    })

    const token = await signToken({
      userId: user.id,
      email: user.email,
      name: user.name,
      isSuperAdmin: user.isSuperAdmin,
    })

    const res = NextResponse.json({
      user: { id: user.id, email: user.email, name: user.name, isSuperAdmin: user.isSuperAdmin },
    })
    setSessionCookie(res, token)
    return res
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: e.errors }, { status: 400 })
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { verifyPassword, signToken, setSessionCookie, signChallengeToken } from '@/lib/auth'
import { checkRateLimit, recordFailure, clearFailures, clientKey } from '@/lib/security/rate-limit'

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
})

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { email, password } = schema.parse(body)
    const normalizedEmail = email.toLowerCase()

    const key = clientKey(req, normalizedEmail)
    const limit = checkRateLimit(key, { shortMax: 5, longMax: 20 })
    if (!limit.allowed) {
      return NextResponse.json(
        { error: 'Too many attempts. Please try again later.' },
        { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } }
      )
    }

    const user = await db.user.findUnique({ where: { email: normalizedEmail } })
    if (!user || !user.isActive) {
      recordFailure(key)
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
    }

    const valid = await verifyPassword(password, user.passwordHash)
    if (!valid) {
      recordFailure(key)
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
    }

    clearFailures(key)

    // If user has 2FA enabled, don't issue a session yet — return a challenge
    // token that the client uses to POST /api/auth/2fa/challenge with the code.
    if (user.totpEnabled) {
      const challenge = await signChallengeToken(user.id)
      return NextResponse.json({
        requires2fa: true,
        challengeToken: challenge,
        // Hint so the UI can show the right input.
        method: 'totp',
      })
    }

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

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionFromRequest } from '@/lib/auth'
import { encrypt } from '@/lib/security/encryption'
import { generateSecret, buildOtpauthUri } from '@/lib/security/totp'

/**
 * POST /api/auth/2fa/setup
 *
 * Generates a fresh TOTP secret for the authenticated user, stores it
 * encrypted (totpEnabled stays false), and returns the secret + otpauth URI
 * so the client can render a QR code.
 *
 * The user must POST /api/auth/2fa/verify with a code to actually enable 2FA.
 * This two-step flow prevents lockout from a mis-scanned QR.
 */
export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = await db.user.findUnique({ where: { id: session.userId } })
  if (!user) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (user.totpEnabled) {
    return NextResponse.json(
      { error: '2FA is already enabled. Disable it first to re-enroll.' },
      { status: 409 }
    )
  }

  const secret = generateSecret()
  const issuer = process.env.APP_NAME || 'LedgerPro'
  const uri = buildOtpauthUri({ secret, accountName: user.email, issuer })

  // Persist the encrypted secret; finalize on /verify.
  await db.user.update({
    where: { id: user.id },
    data: { totpSecret: encrypt(secret) },
  })

  return NextResponse.json({
    secret,                     // shown alongside QR for manual entry
    otpauthUri: uri,            // client renders this as QR
    issuer,
    accountName: user.email,
  })
}

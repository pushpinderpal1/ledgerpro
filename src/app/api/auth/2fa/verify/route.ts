import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { getSessionFromRequest } from '@/lib/auth'
import { decrypt } from '@/lib/security/encryption'
import { verifyTotp } from '@/lib/security/totp'
import { regenerateForUser } from '@/lib/security/backup-codes'

const schema = z.object({ code: z.string().min(6).max(10) })

/**
 * POST /api/auth/2fa/verify
 *
 * Confirms the user's authenticator is set up by verifying a fresh 6-digit
 * code, then flips `totpEnabled = true` and issues one-time backup codes.
 *
 * The backup codes are returned ONCE in the response body — never again.
 * The client is responsible for showing them to the user and warning that
 * they must be saved.
 */
export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { code } = schema.parse(await req.json())

    const user = await db.user.findUnique({ where: { id: session.userId } })
    if (!user) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (!user.totpSecret) return NextResponse.json({ error: 'Run /setup first' }, { status: 400 })
    if (user.totpEnabled) return NextResponse.json({ error: 'Already enabled' }, { status: 409 })

    const secret = decrypt(user.totpSecret)
    if (!verifyTotp(secret, code)) {
      return NextResponse.json({ error: 'Invalid code' }, { status: 400 })
    }

    await db.user.update({
      where: { id: user.id },
      data: { totpEnabled: true, totpVerifiedAt: new Date() },
    })

    const backupCodes = await regenerateForUser(user.id)

    return NextResponse.json({ enabled: true, backupCodes })
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: e.errors }, { status: 400 })
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
}

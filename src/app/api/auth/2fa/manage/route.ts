import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { getSessionFromRequest, verifyPassword } from '@/lib/auth'
import { decrypt } from '@/lib/security/encryption'
import { verifyTotp } from '@/lib/security/totp'
import { consumeBackupCode, regenerateForUser, unusedCount } from '@/lib/security/backup-codes'

/**
 * POST /api/auth/2fa/manage  — body { action, ... }
 *
 *   action = "disable"               → requires password AND a current 2FA code
 *   action = "regenerate-codes"      → requires a current 2FA code; returns new codes
 *   action = "status"                → returns { enabled, backupCodesRemaining }
 *
 * All actions require an active session.
 */
const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('status') }),
  z.object({
    action: z.literal('disable'),
    password: z.string().min(8),
    code: z.string().min(6).max(20),
  }),
  z.object({
    action: z.literal('regenerate-codes'),
    code: z.string().min(6).max(20),
  }),
])

export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = schema.parse(await req.json())
    const user = await db.user.findUnique({ where: { id: session.userId } })
    if (!user) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    if (body.action === 'status') {
      return NextResponse.json({
        enabled: user.totpEnabled,
        backupCodesRemaining: user.totpEnabled ? await unusedCount(user.id) : 0,
      })
    }

    if (!user.totpEnabled || !user.totpSecret) {
      return NextResponse.json({ error: '2FA is not enabled' }, { status: 400 })
    }

    // Verify the code (TOTP or backup) for any state-changing action.
    const secret = decrypt(user.totpSecret)
    const cleanCode = body.code.replace(/\s+/g, '')
    let codeOk = /^\d{6}$/.test(cleanCode) && verifyTotp(secret, cleanCode)
    if (!codeOk) codeOk = await consumeBackupCode(user.id, body.code)
    if (!codeOk) return NextResponse.json({ error: 'Invalid code' }, { status: 401 })

    if (body.action === 'disable') {
      const pwOk = await verifyPassword(body.password, user.passwordHash)
      if (!pwOk) return NextResponse.json({ error: 'Invalid password' }, { status: 401 })

      await db.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: user.id },
          data: { totpEnabled: false, totpSecret: null, totpVerifiedAt: null },
        })
        await tx.backupCode.deleteMany({ where: { userId: user.id } })
      })
      return NextResponse.json({ disabled: true })
    }

    // regenerate-codes
    const codes = await regenerateForUser(user.id)
    return NextResponse.json({ backupCodes: codes })
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: e.errors }, { status: 400 })
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
}

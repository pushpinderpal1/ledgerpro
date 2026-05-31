import bcrypt from 'bcryptjs'
import { db } from '../db'
import { generateBackupCode, normalizeBackupCode } from './backup-codes-format'

// Re-export for backward compatibility with any existing callers.
export { generateBackupCode, normalizeBackupCode } from './backup-codes-format'

/**
 * Backup codes for 2FA recovery. Each code is a 10-character alphanumeric token
 * (e.g. "K3X79-PQ2AW"). We store only bcrypt hashes and mark each code consumed
 * on first use — they're literally one-time.
 *
 * The plaintext codes are returned ONLY at generation time and never again.
 * The user must save them somewhere safe; if they lose them and lose their
 * device, an admin must reset 2FA out of band.
 */

const CODE_COUNT = 10

export interface GeneratedBackupCodes {
  plaintext: string[]      // shown to user once
  hashes: { codeHash: string }[]
}

export async function generateBackupCodes(): Promise<GeneratedBackupCodes> {
  const plaintext = Array.from({ length: CODE_COUNT }, () => generateBackupCode())
  const hashes = await Promise.all(
    plaintext.map(async (c) => ({ codeHash: await bcrypt.hash(normalizeBackupCode(c), 10) }))
  )
  return { plaintext, hashes }
}

/**
 * Replace any existing codes for a user with a fresh batch. Returns the
 * plaintext list — callers must show it to the user exactly once.
 */
export async function regenerateForUser(userId: string): Promise<string[]> {
  const { plaintext, hashes } = await generateBackupCodes()
  await db.$transaction(async (tx) => {
    await tx.backupCode.deleteMany({ where: { userId } })
    await tx.backupCode.createMany({
      data: hashes.map((h) => ({ userId, codeHash: h.codeHash })),
    })
  })
  return plaintext
}

/**
 * Attempt to consume a backup code. Returns true if it matched an unused code
 * (which is now marked used) and false otherwise.
 */
export async function consumeBackupCode(userId: string, code: string): Promise<boolean> {
  const normalized = normalizeBackupCode(code)
  if (normalized.length < 8) return false

  const candidates = await db.backupCode.findMany({
    where: { userId, usedAt: null },
  })
  for (const c of candidates) {
    if (await bcrypt.compare(normalized, c.codeHash)) {
      await db.backupCode.update({
        where: { id: c.id },
        data: { usedAt: new Date() },
      })
      return true
    }
  }
  return false
}

export async function unusedCount(userId: string): Promise<number> {
  return db.backupCode.count({ where: { userId, usedAt: null } })
}

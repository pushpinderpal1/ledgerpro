import { randomBytes } from 'crypto'

/**
 * Pure formatting helpers for backup codes — no DB dependency, freely
 * importable from tests and from environments without Prisma.
 *
 * Format: XXXXX-XXXXX (5+5 characters from an unambiguous alphabet).
 *
 * Alphabet omits 0/O/1/I to avoid user-transcription errors. With 32 chars and
 * 10 positions: 32^10 ≈ 1.1e15 possibilities — collision-free at practical scales.
 */

export const CODE_CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export function generateBackupCode(): string {
  const bytes = randomBytes(10)
  let out = ''
  for (let i = 0; i < 10; i++) {
    out += CODE_CHARSET[bytes[i] % CODE_CHARSET.length]
    if (i === 4) out += '-'
  }
  return out
}

/** Normalize for comparison: strip whitespace/dashes, uppercase. */
export function normalizeBackupCode(code: string): string {
  return code.replace(/[\s-]+/g, '').toUpperCase()
}

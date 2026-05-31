import { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual } from 'crypto'

/**
 * Symmetric encryption for sensitive field-level data (TOTP secrets, future:
 * ACH account numbers, etc.). AES-256-GCM with a random 12-byte IV per record.
 *
 * Storage format (base64):  iv (12) || ciphertext || authTag (16)
 *
 * Key sourcing priority:
 *   1. ENCRYPTION_KEY env var (32 raw bytes hex or base64, recommended for prod)
 *   2. Derived from JWT_SECRET via scrypt (acceptable for single-tenant dev;
 *      rotating JWT_SECRET will brick existing ciphertext, so prefer #1).
 *
 * Set in AWS: `aws secretsmanager` or Parameter Store, injected as ENCRYPTION_KEY.
 * Generate one with: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
 */

let cachedKey: Buffer | null = null

function getKey(): Buffer {
  if (cachedKey) return cachedKey

  const raw = process.env.ENCRYPTION_KEY
  if (raw) {
    let buf: Buffer
    if (/^[0-9a-f]{64}$/i.test(raw)) buf = Buffer.from(raw, 'hex')
    else buf = Buffer.from(raw, 'base64')
    if (buf.length !== 32) {
      throw new Error('ENCRYPTION_KEY must decode to exactly 32 bytes')
    }
    cachedKey = buf
    return buf
  }

  // Fallback: derive from JWT_SECRET. Logs a warning so this isn't missed.
  const jwt = process.env.JWT_SECRET
  if (!jwt || jwt.length < 16) {
    throw new Error('Set ENCRYPTION_KEY (32 bytes hex/base64) for at-rest encryption')
  }
  if (process.env.NODE_ENV === 'production') {
    // Once is fine; we don't want to log secrets repeatedly.
    console.warn(
      '[encryption] WARNING: ENCRYPTION_KEY unset; derived from JWT_SECRET. ' +
      'Rotating JWT_SECRET will invalidate stored secrets. Set ENCRYPTION_KEY explicitly.'
    )
  }
  cachedKey = scryptSync(jwt, 'ledgerpro-enc-v1', 32)
  return cachedKey
}

export function encrypt(plaintext: string): string {
  const key = getKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, ct, tag]).toString('base64')
}

export function decrypt(blob: string): string {
  const key = getKey()
  const buf = Buffer.from(blob, 'base64')
  if (buf.length < 12 + 16) throw new Error('Ciphertext too short')
  const iv = buf.subarray(0, 12)
  const tag = buf.subarray(buf.length - 16)
  const ct = buf.subarray(12, buf.length - 16)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')
}

/** Constant-time string compare, useful for tokens and codes. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

// Exposed for tests so they can use a fixed key without env vars.
export const __testing = {
  setKey(k: Buffer) { cachedKey = k },
  reset() { cachedKey = null },
}

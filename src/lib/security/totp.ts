import { createHmac, randomBytes } from 'crypto'
import { safeEqual } from './encryption'

/**
 * RFC 6238 TOTP (Time-based One-Time Password) implementation.
 *
 * Compatible with Google Authenticator, Authy, 1Password, and any RFC-compliant
 * authenticator app. Default parameters match those apps: 30-second period,
 * 6-digit codes, SHA-1 (per RFC 4226).
 *
 * We implement this directly rather than pull in `otplib`/`speakeasy` so the
 * algorithm and clock-skew window are explicit and auditable.
 */

const DIGITS = 6
const PERIOD_SECONDS = 30
const ALGORITHM = 'sha1'

// Base32 (RFC 4648) for compatibility with authenticator apps.
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function generateSecret(byteLength: number = 20): string {
  // RFC 4226 recommends ≥ 128 bits (16 bytes); Google Authenticator uses 80 bits;
  // 20 bytes (160 bits) matches SHA-1 block and is the de-facto standard.
  return base32Encode(randomBytes(byteLength))
}

/** Build an otpauth:// URI for QR-code provisioning. */
export function buildOtpauthUri(opts: {
  secret: string
  accountName: string    // typically the user's email
  issuer: string         // app name, e.g. "LedgerPro"
}): string {
  const params = new URLSearchParams({
    secret: opts.secret,
    issuer: opts.issuer,
    algorithm: ALGORITHM.toUpperCase(),
    digits: String(DIGITS),
    period: String(PERIOD_SECONDS),
  })
  const label = encodeURIComponent(`${opts.issuer}:${opts.accountName}`)
  return `otpauth://totp/${label}?${params.toString()}`
}

/**
 * Verify a user-submitted code against a secret. Accepts ±1 window of clock
 * skew (1 step before, current, 1 step after) — standard tolerance.
 */
export function verifyTotp(secret: string, code: string, now: number = Date.now()): boolean {
  const cleaned = code.replace(/\s+/g, '')
  if (!/^\d{6}$/.test(cleaned)) return false

  const step = Math.floor(now / 1000 / PERIOD_SECONDS)
  for (const offset of [-1, 0, 1]) {
    const computed = generateCode(secret, step + offset)
    if (safeEqual(computed, cleaned)) return true
  }
  return false
}

/** Generate the current code (exposed for tests / debugging). */
export function currentCode(secret: string, now: number = Date.now()): string {
  return generateCode(secret, Math.floor(now / 1000 / PERIOD_SECONDS))
}

// ─── internals ────────────────────────────────────────────────────────────────

function generateCode(secret: string, counter: number): string {
  const key = base32Decode(secret)
  // 8-byte big-endian counter
  const buf = Buffer.alloc(8)
  buf.writeBigUInt64BE(BigInt(counter))
  const hmac = createHmac(ALGORITHM, key).update(buf).digest()
  // Dynamic truncation per RFC 4226 §5.3
  const offset = hmac[hmac.length - 1] & 0x0f
  const code = (
    ((hmac[offset]     & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8)  |
    ( hmac[offset + 3] & 0xff)
  ) % 10 ** DIGITS
  return code.toString().padStart(DIGITS, '0')
}

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = ''
  for (const byte of buf) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 0x1f]
      bits -= 5
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 0x1f]
  return out
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/=+$/, '').replace(/\s+/g, '')
  let bits = 0, value = 0
  const bytes: number[] = []
  for (const ch of clean) {
    const idx = B32.indexOf(ch)
    if (idx === -1) throw new Error(`Invalid base32 character: ${ch}`)
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(bytes)
}

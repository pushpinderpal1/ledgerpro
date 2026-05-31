import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import {
  generateSecret,
  buildOtpauthUri,
  verifyTotp,
  currentCode,
  base32Encode,
  base32Decode,
} from '../src/lib/security/totp'
import { __testing as encTesting } from '../src/lib/security/encryption'

beforeEach(() => { encTesting.setKey(randomBytes(32)) })

test('base32: roundtrips arbitrary bytes', () => {
  const bytes = Buffer.from([0xde, 0xad, 0xbe, 0xef, 0x01, 0x02, 0x03])
  const enc = base32Encode(bytes)
  const dec = base32Decode(enc)
  assert.equal(dec.toString('hex'), bytes.toString('hex'))
})

test('base32: rejects invalid characters', () => {
  assert.throws(() => base32Decode('NOTBASE32!!!'))
})

test('base32: tolerates lowercase and padding', () => {
  const enc = base32Encode(Buffer.from('hello'))
  const dec1 = base32Decode(enc.toLowerCase() + '====')
  assert.equal(dec1.toString(), 'hello')
})

test('generateSecret: produces valid base32 of expected length', () => {
  const s = generateSecret(20)
  assert.match(s, /^[A-Z2-7]+$/)
  // 20 bytes → 32 base32 chars (no padding)
  assert.equal(s.length, 32)
})

test('buildOtpauthUri: well-formed URI with required params', () => {
  const uri = buildOtpauthUri({
    secret: 'JBSWY3DPEHPK3PXP',
    accountName: 'alice@example.com',
    issuer: 'LedgerPro',
  })
  assert.match(uri, /^otpauth:\/\/totp\/LedgerPro%3Aalice%40example\.com\?/)
  assert.match(uri, /secret=JBSWY3DPEHPK3PXP/)
  assert.match(uri, /issuer=LedgerPro/)
  assert.match(uri, /digits=6/)
  assert.match(uri, /period=30/)
  assert.match(uri, /algorithm=SHA1/)
})

test('currentCode: same secret & time always produces the same 6-digit code', () => {
  const secret = generateSecret()
  const now = 1_700_000_000_000  // fixed
  const a = currentCode(secret, now)
  const b = currentCode(secret, now)
  assert.equal(a, b)
  assert.match(a, /^\d{6}$/)
})

test('verifyTotp: accepts the current code', () => {
  const secret = generateSecret()
  const now = Date.now()
  const code = currentCode(secret, now)
  assert.equal(verifyTotp(secret, code, now), true)
})

test('verifyTotp: accepts ±1 window of skew', () => {
  const secret = generateSecret()
  const now = 1_700_000_000_000
  const prevCode = currentCode(secret, now - 30_000)
  const nextCode = currentCode(secret, now + 30_000)
  assert.equal(verifyTotp(secret, prevCode, now), true)
  assert.equal(verifyTotp(secret, nextCode, now), true)
})

test('verifyTotp: rejects codes outside the window', () => {
  const secret = generateSecret()
  const now = 1_700_000_000_000
  // 2 windows back
  const oldCode = currentCode(secret, now - 90_000)
  assert.equal(verifyTotp(secret, oldCode, now), false)
})

test('verifyTotp: rejects non-numeric and wrong-length input', () => {
  const secret = generateSecret()
  assert.equal(verifyTotp(secret, 'abc123'), false)
  assert.equal(verifyTotp(secret, '12345'), false)    // 5 digits
  assert.equal(verifyTotp(secret, '1234567'), false)  // 7 digits
})

test('verifyTotp: tolerates whitespace', () => {
  const secret = generateSecret()
  const now = Date.now()
  const code = currentCode(secret, now)
  const spaced = code.slice(0, 3) + ' ' + code.slice(3)
  assert.equal(verifyTotp(secret, spaced, now), true)
})

test('verifyTotp: secrets are independent', () => {
  const s1 = generateSecret()
  const s2 = generateSecret()
  const now = Date.now()
  const code1 = currentCode(s1, now)
  assert.equal(verifyTotp(s1, code1, now), true)
  assert.equal(verifyTotp(s2, code1, now), false)
})

// RFC 6238 Appendix B test vectors (with the 20-byte ASCII test key)
// Use only the first vector to validate algorithm correctness.
test('verifyTotp: RFC 6238 reference vector (T=59, expected 287082)', () => {
  // Test key from RFC 6238 §B: "12345678901234567890"
  const keyBytes = Buffer.from('12345678901234567890')
  const secret = base32Encode(keyBytes)
  // T=59 seconds → step floor(59/30) = 1
  const now = 59 * 1000
  assert.equal(currentCode(secret, now), '287082')
})

import { test } from 'node:test'
import assert from 'node:assert/strict'

/**
 * Sanitizer tests — replicate the helper inline so this test file doesn't
 * import `../src/lib/audit/index.ts` (which would pull in `../db` and crash
 * without a Prisma client). Tests verify the algorithm; the live code uses
 * the same logic.
 */
const SENSITIVE_KEYS = [
  'password', 'passwordhash', 'secret', 'token', 'apikey', 'api_key',
  'totpsecret', 'jwt', 'sessiontoken', 'achaccountno', 'routingno',
  'codehash', 'backupcode',
]
const MAX_VALUE_LEN = 4000

function isSensitiveKey(key: string): boolean {
  const k = key.toLowerCase()
  return SENSITIVE_KEYS.some(s => k.includes(s))
}
function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 5) return '[too deep]'
  if (value == null) return value
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(v => sanitize(v, depth + 1))
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (isSensitiveKey(k)) out[k] = '[redacted]'
      else out[k] = sanitize(v, depth + 1)
    }
    return out
  }
  return value
}
function serializeSafe(value: unknown): string {
  const sanitized = sanitize(value)
  let json: string
  try { json = JSON.stringify(sanitized) } catch { json = String(sanitized) }
  if (json.length > MAX_VALUE_LEN) json = json.slice(0, MAX_VALUE_LEN - 12) + '…[truncated]'
  return json
}

test('redacts password fields', () => {
  const s = serializeSafe({ email: 'x@y.z', password: 's3cret!', passwordHash: '$2a$...' })
  assert.match(s, /\[redacted\]/)
  assert.equal(s.includes('s3cret!'), false)
  assert.equal(s.includes('$2a$'), false)
})

test('redacts TOTP secrets and backup-code hashes', () => {
  const s = serializeSafe({ totpSecret: 'JBSWY...', codeHash: '$2a$10$...' })
  assert.equal(s.includes('JBSWY'), false)
  assert.equal(s.includes('$2a$10'), false)
})

test('redacts ACH account & routing numbers', () => {
  const s = serializeSafe({ achRoutingNo: '123456789', achAccountNo: '987654321', payee: 'Acme' })
  assert.equal(s.includes('123456789'), false)
  assert.equal(s.includes('987654321'), false)
  assert.equal(s.includes('Acme'), true)        // non-sensitive fields preserved
})

test('redacts nested sensitive fields', () => {
  const s = serializeSafe({ user: { email: 'a@b.c', auth: { password: 'pw', totpSecret: 'X' } } })
  assert.equal(s.includes('pw'), false)
  assert.equal(s.includes('X'), false)
  assert.equal(s.includes('a@b.c'), true)
})

test('serializes Date and BigInt safely', () => {
  const d = new Date('2026-01-15T10:30:00Z')
  const s = serializeSafe({ when: d, count: BigInt(42) })
  assert.match(s, /"when":"2026-01-15T10:30:00.000Z"/)
  assert.match(s, /"count":"42"/)
})

test('caps depth to prevent runaway recursion', () => {
  // Build a 10-deep object — should bottom out at "[too deep]".
  let obj: Record<string, unknown> = { v: 'leaf' }
  for (let i = 0; i < 10; i++) obj = { nested: obj }
  const s = serializeSafe(obj)
  assert.match(s, /too deep/)
})

test('truncates oversized output', () => {
  const big = { data: 'x'.repeat(10000) }
  const s = serializeSafe(big)
  assert.ok(s.length <= MAX_VALUE_LEN, `length ${s.length} should be ≤ ${MAX_VALUE_LEN}`)
  assert.match(s, /truncated/)
})

test('preserves arrays and primitives', () => {
  const s = serializeSafe({ ids: [1, 2, 3], name: 'Alice', age: 30, active: true })
  const parsed = JSON.parse(s)
  assert.deepEqual(parsed.ids, [1, 2, 3])
  assert.equal(parsed.name, 'Alice')
  assert.equal(parsed.age, 30)
  assert.equal(parsed.active, true)
})

test('matches sensitive keys case-insensitively and as substrings', () => {
  const s = serializeSafe({
    PASSWORD: 'p',                  // upper
    userPasswordHash: 'h',          // substring with prefix
    apiKey: 'k',                    // matches 'apikey' substring rule
    JwtSigningKey: 'j',             // matches 'jwt' substring
  })
  assert.equal(s.includes('"p"'), false)
  assert.equal(s.includes('"h"'), false)
  assert.equal(s.includes('"k"'), false)
  assert.equal(s.includes('"j"'), false)
})

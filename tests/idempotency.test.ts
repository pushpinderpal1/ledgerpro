import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

/**
 * The idempotency middleware hashes the request body with SHA-256 and matches
 * against a stored record under a (entityId, key) pair. These tests verify the
 * core invariants the middleware relies on without exercising the DB.
 */

function hashBody(body: unknown): string {
  const str = typeof body === 'string' ? body : JSON.stringify(body ?? {})
  return createHash('sha256').update(str).digest('hex')
}

test('identical bodies hash to the same digest', () => {
  const a = { amount: 100, payee: 'Acme' }
  const b = { amount: 100, payee: 'Acme' }
  assert.equal(hashBody(a), hashBody(b))
})

test('different bodies hash differently', () => {
  assert.notEqual(
    hashBody({ amount: 100 }),
    hashBody({ amount: 100.01 })
  )
})

test('property order matters (caller responsibility to send canonical JSON)', () => {
  // We intentionally don't canonicalize — this documents the contract.
  const a = JSON.stringify({ a: 1, b: 2 })
  const b = JSON.stringify({ b: 2, a: 1 })
  assert.notEqual(a, b)
  assert.notEqual(hashBody(a), hashBody(b))
})

test('idempotency-key format constraint (UUID-ish)', () => {
  const KEY_FORMAT = /^[A-Za-z0-9_\-]{8,128}$/
  assert.ok(KEY_FORMAT.test('a1b2c3d4-e5f6-7890-abcd-ef1234567890'))
  assert.ok(KEY_FORMAT.test('payment_2026-05-29_001'))
  assert.equal(KEY_FORMAT.test('short'), false)        // < 8 chars
  assert.equal(KEY_FORMAT.test('has space here xxx'), false)
  assert.equal(KEY_FORMAT.test('symbols$@!xxxx'), false)
})

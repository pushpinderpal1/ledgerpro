import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { encrypt, decrypt, safeEqual, __testing } from '../src/lib/security/encryption'

beforeEach(() => {
  // Use a fixed key for deterministic tests, but rotate per test for isolation.
  __testing.setKey(randomBytes(32))
})

test('roundtrips: plaintext -> encrypt -> decrypt = plaintext', () => {
  const plain = 'KZXW6YTBOI======'
  const ct = encrypt(plain)
  assert.notEqual(ct, plain)
  assert.equal(decrypt(ct), plain)
})

test('roundtrips: empty string', () => {
  assert.equal(decrypt(encrypt('')), '')
})

test('roundtrips: unicode', () => {
  const plain = '🔐 secret 漢字'
  assert.equal(decrypt(encrypt(plain)), plain)
})

test('every encryption produces a unique ciphertext (random IV)', () => {
  const a = encrypt('same plaintext')
  const b = encrypt('same plaintext')
  assert.notEqual(a, b)
})

test('decrypt with wrong key fails', () => {
  const ct = encrypt('secret')
  __testing.setKey(randomBytes(32))   // rotate
  assert.throws(() => decrypt(ct))
})

test('decrypt rejects tampered ciphertext', () => {
  const ct = encrypt('secret')
  // Flip a byte in the middle.
  const buf = Buffer.from(ct, 'base64')
  buf[buf.length - 5] ^= 0xff
  assert.throws(() => decrypt(buf.toString('base64')))
})

test('decrypt rejects truncated ciphertext', () => {
  assert.throws(() => decrypt('YQ=='))      // 1 byte, way under minimum
  assert.throws(() => decrypt(''))
})

test('safeEqual: matches', () => {
  assert.equal(safeEqual('abc', 'abc'), true)
})

test('safeEqual: rejects length mismatch without throwing', () => {
  assert.equal(safeEqual('abc', 'abcd'), false)
})

test('safeEqual: rejects different content', () => {
  assert.equal(safeEqual('abc', 'abd'), false)
})

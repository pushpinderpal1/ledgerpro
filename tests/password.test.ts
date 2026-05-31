import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkPasswordStrength } from '../src/lib/security/password'

test('rejects passwords under 12 characters', () => {
  const r = checkPasswordStrength('Short1!')
  assert.equal(r.ok, false)
  assert.match(r.reasons.join(' '), /at least 12/)
})

test('rejects passwords over 128 characters', () => {
  const r = checkPasswordStrength('A1!' + 'a'.repeat(130))
  assert.equal(r.ok, false)
  assert.match(r.reasons.join(' '), /128/)
})

test('rejects with fewer than 3 character classes', () => {
  const r = checkPasswordStrength('alllowercaseonly')
  assert.equal(r.ok, false)
  assert.match(r.reasons.join(' '), /3 of/)
})

test('accepts a strong password', () => {
  const r = checkPasswordStrength('Tr0ub4dor&3xtras!')
  assert.equal(r.ok, true, r.reasons.join(', '))
  assert.deepEqual(r.reasons, [])
})

test('rejects the breached common-password list', () => {
  for (const pw of ['password123', 'letmein123', 'welcome']) {
    const r = checkPasswordStrength(pw + 'XX')   // pad past length check
    assert.equal(r.ok, false, `${pw} should be rejected`)
  }
})

test('rejects a single repeated character', () => {
  const r = checkPasswordStrength('aaaaaaaaaaaa')
  assert.equal(r.ok, false)
})

test('handles non-string input gracefully', () => {
  // @ts-expect-error testing runtime safety
  const r = checkPasswordStrength(undefined)
  assert.equal(r.ok, false)
})

test('accepts 3-of-4 character classes (no symbols)', () => {
  const r = checkPasswordStrength('CorrectHorse2026')
  assert.equal(r.ok, true, r.reasons.join(', '))
})

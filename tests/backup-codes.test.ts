import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateBackupCode, normalizeBackupCode } from '../src/lib/security/backup-codes-format'

test('generateBackupCode: matches expected format X5-X5', () => {
  for (let i = 0; i < 50; i++) {
    const code = generateBackupCode()
    assert.match(code, /^[A-Z0-9]{5}-[A-Z0-9]{5}$/)
  }
})

test('generateBackupCode: omits ambiguous characters 0/O/1/I', () => {
  for (let i = 0; i < 100; i++) {
    const code = generateBackupCode()
    assert.equal(/[01OI]/.test(code), false, `Code ${code} contains ambiguous char`)
  }
})

test('generateBackupCode: codes are distinct (no immediate collisions)', () => {
  const seen = new Set<string>()
  for (let i = 0; i < 1000; i++) seen.add(generateBackupCode())
  // Collision rate should be negligible at 32^10 / 1000 trials.
  assert.equal(seen.size, 1000)
})

test('normalizeBackupCode: strips dashes and whitespace, uppercases', () => {
  assert.equal(normalizeBackupCode('abc12-de345'), 'ABC12DE345')
  assert.equal(normalizeBackupCode('  abc 12 - de 345  '), 'ABC12DE345')
  assert.equal(normalizeBackupCode('ABC12-DE345'), 'ABC12DE345')
})

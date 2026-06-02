import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseRequiredTypes,
  serializeRequiredTypes,
  validateLines,
  isMisRequiredFor,
  shouldShowMisField,
  type MisPolicy,
} from '../src/lib/mis/policy'

// ─── parse / serialize ─────────────────────────────────────────────────────────
test('parseRequiredTypes: handles empty', () => {
  assert.deepEqual(parseRequiredTypes(''), [])
})

test('parseRequiredTypes: trims and uppercases', () => {
  assert.deepEqual(parseRequiredTypes(' expense, revenue ,COGS '), ['EXPENSE', 'REVENUE', 'COGS'])
})

test('parseRequiredTypes: filters out unknown tokens', () => {
  assert.deepEqual(parseRequiredTypes('EXPENSE,FOO,REVENUE'), ['EXPENSE', 'REVENUE'])
})

test('serializeRequiredTypes: dedupes', () => {
  assert.equal(serializeRequiredTypes(['EXPENSE', 'EXPENSE', 'REVENUE']), 'EXPENSE,REVENUE')
})

// ─── validateLines ────────────────────────────────────────────────────────────

const disabled: MisPolicy = { enabled: false, requiredForTypes: [], allowOverride: false }
const strict: MisPolicy = { enabled: true, requiredForTypes: ['EXPENSE', 'REVENUE', 'COGS'], allowOverride: false }
const lenient: MisPolicy = { enabled: true, requiredForTypes: ['EXPENSE', 'REVENUE', 'COGS'], allowOverride: true }

test('validateLines: no issues when MIS is disabled', () => {
  const issues = validateLines(disabled, [
    { accountType: 'EXPENSE', misCodeId: null, lineOrder: 0 },
    { accountType: 'REVENUE', misCodeId: null, lineOrder: 1 },
  ])
  assert.equal(issues.length, 0)
})

test('validateLines: strict — missing MIS on required type blocks', () => {
  const issues = validateLines(strict, [
    { accountType: 'EXPENSE', misCodeId: null, lineOrder: 0 },
  ])
  assert.equal(issues.length, 1)
  assert.equal(issues[0].severity, 'error')
})

test('validateLines: strict — MIS present passes', () => {
  const issues = validateLines(strict, [
    { accountType: 'EXPENSE', misCodeId: 'mis_abc', lineOrder: 0 },
    { accountType: 'ASSET',   misCodeId: null,      lineOrder: 1 },   // not in required list
  ])
  assert.equal(issues.length, 0)
})

test('validateLines: strict — non-required types are ignored', () => {
  const issues = validateLines(strict, [
    { accountType: 'ASSET',     misCodeId: null, lineOrder: 0 },
    { accountType: 'LIABILITY', misCodeId: null, lineOrder: 1 },
    { accountType: 'EQUITY',    misCodeId: null, lineOrder: 2 },
  ])
  assert.equal(issues.length, 0)
})

test('validateLines: lenient — missing MIS becomes a warning, not an error', () => {
  const issues = validateLines(lenient, [
    { accountType: 'EXPENSE', misCodeId: null, lineOrder: 0 },
  ])
  assert.equal(issues.length, 1)
  assert.equal(issues[0].severity, 'warning')
})

test('validateLines: empty whitespace MIS treated as missing', () => {
  const issues = validateLines(strict, [
    { accountType: 'EXPENSE', misCodeId: '   ', lineOrder: 0 },
  ])
  assert.equal(issues.length, 1)
  assert.equal(issues[0].severity, 'error')
})

test('validateLines: reports each missing line, not just the first', () => {
  const issues = validateLines(strict, [
    { accountType: 'EXPENSE', misCodeId: null, lineOrder: 0 },
    { accountType: 'REVENUE', misCodeId: null, lineOrder: 1 },
    { accountType: 'COGS',    misCodeId: 'm', lineOrder: 2 },
  ])
  assert.equal(issues.length, 2)
})

test('validateLines: empty requiredForTypes returns no issues', () => {
  const p: MisPolicy = { enabled: true, requiredForTypes: [], allowOverride: false }
  const issues = validateLines(p, [
    { accountType: 'EXPENSE', misCodeId: null, lineOrder: 0 },
  ])
  assert.equal(issues.length, 0)
})

// ─── isMisRequiredFor ────────────────────────────────────────────────────────

test('isMisRequiredFor: matrix', () => {
  assert.equal(isMisRequiredFor(disabled, 'EXPENSE'), false)
  assert.equal(isMisRequiredFor(strict,   'EXPENSE'), true)
  assert.equal(isMisRequiredFor(strict,   'ASSET'),   false)
  assert.equal(isMisRequiredFor(lenient,  'EXPENSE'), false)        // override flips it off
})

test('shouldShowMisField: tracks enabled flag', () => {
  assert.equal(shouldShowMisField(disabled), false)
  assert.equal(shouldShowMisField(strict),   true)
  assert.equal(shouldShowMisField(lenient),  true)
})

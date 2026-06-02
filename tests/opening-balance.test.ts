import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  accountIsDebitNatural,
  computeOpeningBalanceLines,
  resolveOpeningDate,
  formatNaturalBalance,
} from '../src/lib/opening-balance'

test('accountIsDebitNatural classifies the six account types', () => {
  assert.equal(accountIsDebitNatural('ASSET'),     true)
  assert.equal(accountIsDebitNatural('EXPENSE'),   true)
  assert.equal(accountIsDebitNatural('COGS'),      true)
  assert.equal(accountIsDebitNatural('LIABILITY'), false)
  assert.equal(accountIsDebitNatural('EQUITY'),    false)
  assert.equal(accountIsDebitNatural('REVENUE'),   false)
})

test('computeOpeningBalanceLines: zero balance returns null', () => {
  const out = computeOpeningBalanceLines({
    account: { id: 'a1', type: 'ASSET' },
    openingBalance: 0, obeAccountId: 'obe',
  })
  assert.equal(out, null)
})

test('computeOpeningBalanceLines: ASSET +5000 → DR account / CR OBE', () => {
  const out = computeOpeningBalanceLines({
    account: { id: 'cash', type: 'ASSET' },
    openingBalance: 5000, obeAccountId: 'obe',
  })!
  assert.deepEqual(out[0], { accountId: 'cash', debit: 5000, credit: 0, lineOrder: 0, description: 'Opening balance' })
  assert.deepEqual(out[1], { accountId: 'obe',  debit: 0,    credit: 5000, lineOrder: 1, description: 'Opening balance contra (OBE)' })
  // Balanced
  assert.equal(out[0].debit + out[1].debit, out[0].credit + out[1].credit)
})

test('computeOpeningBalanceLines: LIABILITY +3000 → CR account / DR OBE', () => {
  const out = computeOpeningBalanceLines({
    account: { id: 'ap', type: 'LIABILITY' },
    openingBalance: 3000, obeAccountId: 'obe',
  })!
  assert.equal(out[0].credit, 3000)
  assert.equal(out[0].debit, 0)
  assert.equal(out[1].debit, 3000)
  assert.equal(out[1].credit, 0)
})

test('computeOpeningBalanceLines: REVENUE +1500 → CR account', () => {
  const out = computeOpeningBalanceLines({
    account: { id: 'sales', type: 'REVENUE' },
    openingBalance: 1500, obeAccountId: 'obe',
  })!
  assert.equal(out[0].credit, 1500)
})

test('computeOpeningBalanceLines: EXPENSE +200 → DR account', () => {
  const out = computeOpeningBalanceLines({
    account: { id: 'rent', type: 'EXPENSE' },
    openingBalance: 200, obeAccountId: 'obe',
  })!
  assert.equal(out[0].debit, 200)
})

test('computeOpeningBalanceLines: NEGATIVE flips sides', () => {
  // Negative on an asset means the account actually has a CR balance (unusual)
  const out = computeOpeningBalanceLines({
    account: { id: 'cash', type: 'ASSET' },
    openingBalance: -100, obeAccountId: 'obe',
  })!
  assert.equal(out[0].credit, 100)
  assert.equal(out[0].debit, 0)
  assert.equal(out[1].debit, 100)
})

test('resolveOpeningDate uses entity.openingDate when set', () => {
  const d = new Date('2024-06-01')
  assert.equal(resolveOpeningDate({ openingDate: d }).getTime(), d.getTime())
})

test('resolveOpeningDate falls back to Jan 1 of current year', () => {
  const now = new Date('2026-08-15')
  const d = resolveOpeningDate({ openingDate: null }, now)
  assert.equal(d.getFullYear(), 2026)
  assert.equal(d.getMonth(), 0)
  assert.equal(d.getDate(), 1)
})

test('formatNaturalBalance: DR-natural account with positive signed is natural DR', () => {
  const r = formatNaturalBalance(500, 'ASSET')
  assert.deepEqual(r, { amount: 500, side: 'DR', isUnnatural: false })
})

test('formatNaturalBalance: CR-natural account with negative signed is natural CR', () => {
  const r = formatNaturalBalance(-300, 'LIABILITY')
  assert.deepEqual(r, { amount: 300, side: 'CR', isUnnatural: false })
})

test('formatNaturalBalance: ASSET with negative signed is UNNATURAL (CR)', () => {
  const r = formatNaturalBalance(-100, 'ASSET')
  assert.deepEqual(r, { amount: 100, side: 'CR', isUnnatural: true })
})

test('formatNaturalBalance: zero is ZERO', () => {
  assert.deepEqual(formatNaturalBalance(0, 'ASSET'),
                   { amount: 0, side: 'ZERO', isUnnatural: false })
})

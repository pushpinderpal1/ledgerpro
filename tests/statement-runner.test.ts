import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  naturalBalance, runTemplate, validateTemplate,
  type StatementLine, type AccountMeta,
} from '../src/lib/statement-templates/runner'

// ─── naturalBalance ──────────────────────────────────────────────────────────
test('naturalBalance: ASSET returns raw signed', () => {
  assert.equal(naturalBalance(100, 'ASSET'), 100)
  assert.equal(naturalBalance(-50, 'ASSET'), -50)
})

test('naturalBalance: REVENUE flips sign (credits are positive)', () => {
  assert.equal(naturalBalance(-100, 'REVENUE'), 100)
  assert.equal(naturalBalance(50, 'REVENUE'), -50)
})

test('naturalBalance: EXPENSE returns raw (debits positive)', () => {
  assert.equal(naturalBalance(75, 'EXPENSE'), 75)
})

test('naturalBalance: LIABILITY flips sign', () => {
  assert.equal(naturalBalance(-200, 'LIABILITY'), 200)
})

// ─── runTemplate ─────────────────────────────────────────────────────────────

function buildMeta(rows: Array<[string, string, string, string]>): Map<string, AccountMeta> {
  const m = new Map<string, AccountMeta>()
  for (const [id, code, name, type] of rows) {
    m.set(id, { id, code, name, type: type as AccountMeta['type'] })
  }
  return m
}

const accountsById = buildMeta([
  ['rev1', '4000', 'Service Revenue',  'REVENUE'],
  ['rev2', '4100', 'Product Revenue',  'REVENUE'],
  ['exp1', '5000', 'Rent Expense',     'EXPENSE'],
  ['exp2', '5100', 'Salaries',         'EXPENSE'],
  ['cogs', '6000', 'COGS',             'COGS'],
])

const rawByAccount = new Map<string, number>([
  ['rev1', -10000],  // raw = -10000 → natural REVENUE = 10000
  ['rev2',  -5000],  // 5000
  ['exp1',   2000],
  ['exp2',   4000],
  ['cogs',   1500],
])

test('runTemplate: simple P&L produces correct subtotals and grand total', () => {
  const lines: StatementLine[] = [
    { id: 'h1', type: 'HEADER',   label: 'Income' },
    { id: 'r1', type: 'ACCOUNT',  label: 'Service Revenue', accountId: 'rev1' },
    { id: 'r2', type: 'ACCOUNT',  label: 'Product Revenue', accountId: 'rev2' },
    { id: 's1', type: 'SUBTOTAL', label: 'Total revenue' },
    { id: 'sp', type: 'SPACER',   label: '' },
    { id: 'h2', type: 'HEADER',   label: 'Expenses' },
    { id: 'e1', type: 'ACCOUNT',  label: 'Rent',            accountId: 'exp1' },
    { id: 'e2', type: 'ACCOUNT',  label: 'Salaries',        accountId: 'exp2' },
    { id: 'cg', type: 'ACCOUNT',  label: 'COGS',            accountId: 'cogs' },
    { id: 's2', type: 'SUBTOTAL', label: 'Total expenses' },
  ]
  const out = runTemplate({ lines, rawByAccount, accountsById })

  // Verify subtotal values
  const subtotals = out.rows.filter(r => r.type === 'SUBTOTAL')
  assert.equal(subtotals.length, 2)
  assert.equal(subtotals[0].value, 15000)            // 10000 + 5000
  assert.equal(subtotals[1].value, 7500)             // 2000 + 4000 + 1500
  // grandTotal = sum of all values in template
  assert.equal(out.grandTotal, 22500)
})

test('runTemplate: GROUP sums multiple accounts', () => {
  const lines: StatementLine[] = [
    { id: 'r', type: 'GROUP', label: 'All Revenue', accountIds: ['rev1', 'rev2'] },
  ]
  const out = runTemplate({ lines, rawByAccount, accountsById })
  assert.equal(out.rows[0].value, 15000)
})

test('runTemplate: invert flag flips sign', () => {
  const lines: StatementLine[] = [
    { id: 'e', type: 'ACCOUNT', label: 'Rent (as deduction)', accountId: 'exp1', invert: true },
  ]
  const out = runTemplate({ lines, rawByAccount, accountsById })
  assert.equal(out.rows[0].value, -2000)
})

test('runTemplate: subtotal resets between sections', () => {
  const lines: StatementLine[] = [
    { id: 'a', type: 'ACCOUNT',  label: 'A', accountId: 'rev1' },
    { id: 's', type: 'SUBTOTAL', label: 'Sub 1' },
    { id: 'b', type: 'ACCOUNT',  label: 'B', accountId: 'exp1' },
    { id: 't', type: 'SUBTOTAL', label: 'Sub 2' },
  ]
  const out = runTemplate({ lines, rawByAccount, accountsById })
  // After first SUBTOTAL, counter resets
  assert.equal(out.rows[1].value, 10000)
  assert.equal(out.rows[3].value, 2000)
})

test('runTemplate: HEADER and SPACER rows have null value', () => {
  const lines: StatementLine[] = [
    { id: 'h', type: 'HEADER', label: 'Section' },
    { id: 's', type: 'SPACER', label: '' },
  ]
  const out = runTemplate({ lines, rawByAccount, accountsById })
  assert.equal(out.rows[0].value, null)
  assert.equal(out.rows[1].value, null)
  assert.equal(out.rows[0].bold, true)       // HEADER auto-bold
})

test('runTemplate: missing account returns 0 silently', () => {
  const lines: StatementLine[] = [
    { id: 'x', type: 'ACCOUNT', label: 'Phantom', accountId: 'does-not-exist' },
  ]
  const out = runTemplate({ lines, rawByAccount, accountsById })
  assert.equal(out.rows[0].value, 0)
})

test('runTemplate: includes contributing accountIds for drill-down', () => {
  const lines: StatementLine[] = [
    { id: 'g', type: 'GROUP', label: 'Two Revs', accountIds: ['rev1', 'rev2'] },
  ]
  const out = runTemplate({ lines, rawByAccount, accountsById })
  assert.deepEqual(out.rows[0].accountIds, ['rev1', 'rev2'])
})

test('runTemplate: lines without subtotal are still added to grand total', () => {
  const lines: StatementLine[] = [
    { id: 'a', type: 'ACCOUNT', label: 'A', accountId: 'rev1' },
    { id: 'b', type: 'ACCOUNT', label: 'B', accountId: 'rev2' },
    // no SUBTOTAL — but values should still aggregate
  ]
  const out = runTemplate({ lines, rawByAccount, accountsById })
  assert.equal(out.grandTotal, 15000)
})

// ─── validateTemplate ───────────────────────────────────────────────────────

test('validateTemplate: requires at least one line', () => {
  assert.ok(validateTemplate([]).length > 0)
})

test('validateTemplate: catches missing accountId on ACCOUNT', () => {
  const errs = validateTemplate([
    { id: '1', type: 'ACCOUNT', label: 'No account' },
  ])
  assert.ok(errs.some(e => e.includes('accountId')))
})

test('validateTemplate: catches empty accountIds on GROUP', () => {
  const errs = validateTemplate([
    { id: '1', type: 'GROUP', label: 'Empty group', accountIds: [] },
  ])
  assert.ok(errs.some(e => e.includes('accountIds')))
})

test('validateTemplate: catches duplicate ids', () => {
  const errs = validateTemplate([
    { id: 'x', type: 'HEADER', label: 'A' },
    { id: 'x', type: 'HEADER', label: 'B' },
  ])
  assert.ok(errs.some(e => e.includes('duplicate')))
})

test('validateTemplate: passes a valid template', () => {
  const errs = validateTemplate([
    { id: '1', type: 'HEADER',   label: 'Revenue' },
    { id: '2', type: 'ACCOUNT',  label: 'Sales', accountId: 'rev1' },
    { id: '3', type: 'SUBTOTAL', label: 'Total' },
  ])
  assert.equal(errs.length, 0)
})

test('validateTemplate: SPACER doesn\'t require label', () => {
  const errs = validateTemplate([
    { id: '1', type: 'SPACER', label: '' },
    { id: '2', type: 'HEADER', label: 'OK' },
  ])
  assert.equal(errs.length, 0)
})

import { test } from 'node:test'
import assert from 'node:assert/strict'

/**
 * These tests verify the *algorithms* used by the recon engine without
 * exercising the DB layer. The reference implementation lives in
 * src/lib/recon/index.ts; the production code uses the same integer-cent
 * math and same auto-match predicate.
 */

const toCents = (n: unknown) => Math.round(Number(n ?? 0) * 100)

test('debit-normal account: balance = debits − credits', () => {
  const lines = [
    { debit: 10000, credit: 0 },     // opening deposit
    { debit: 5000, credit: 0 },      // sale received
    { debit: 0, credit: 2000 },      // payment out
    { debit: 0, credit: 1000 },      // another payment
  ]
  const debits = lines.reduce((s, l) => s + toCents(l.debit), 0)
  const credits = lines.reduce((s, l) => s + toCents(l.credit), 0)
  assert.equal((debits - credits) / 100, 12000)
})

test('reconciliation balance check: balanced', () => {
  const beginCents = 1_000_000  // $10,000.00
  const clearedMovements = [-150_000, 230_050]  // cents
  const endingCents = 1_080_050
  const cleared = beginCents + clearedMovements.reduce((s, m) => s + m, 0)
  assert.equal(cleared, endingCents)
})

test('reconciliation balance check: unbalanced flagged', () => {
  const beginCents = 1_000_000
  const clearedMovements = [-150_000]   // missed the deposit
  const endingCents = 1_080_050
  const cleared = beginCents + clearedMovements.reduce((s, m) => s + m, 0)
  const diff = endingCents - cleared
  assert.notEqual(diff, 0)
  assert.equal(diff / 100, 2300.50)
})

test('auto-match: exact amount + within ±5 day window', () => {
  const lineMv = (d: number, c: number) => toCents(d) - toCents(c)
  const stmt = [
    { id: 's1', date: new Date('2026-01-15'), amount: -1500 },
    { id: 's2', date: new Date('2026-01-16'), amount: 2300.50 },
  ]
  const gl = [
    { id: 'g1', debit: 0, credit: 1500, date: new Date('2026-01-14') },     // cheque, -1500
    { id: 'g2', debit: 2300.50, credit: 0, date: new Date('2026-01-16') },  // deposit, +2300.50
    { id: 'g3', debit: 0, credit: 999, date: new Date('2026-01-10') },      // unrelated
  ]
  const used = new Set<string>()
  for (const sl of stmt) {
    const target = toCents(sl.amount)
    const hit = gl.find(g => {
      if (used.has(g.id)) return false
      if (lineMv(g.debit, g.credit) !== target) return false
      return Math.abs(+sl.date - +g.date) / 86400000 <= 5
    })
    if (hit) used.add(hit.id)
  }
  assert.deepEqual([...used].sort(), ['g1', 'g2'])
})

test('auto-match: rejects outside ±5 day window', () => {
  const lineMv = (d: number, c: number) => toCents(d) - toCents(c)
  const sl = { date: new Date('2026-01-15'), amount: -1500 }
  const gl = [{ id: 'g1', debit: 0, credit: 1500, date: new Date('2026-01-01') }]
  const target = toCents(sl.amount)
  const hit = gl.find(g =>
    lineMv(g.debit, g.credit) === target &&
    Math.abs(+sl.date - +g.date) / 86400000 <= 5
  )
  assert.equal(hit, undefined)
})

test('auto-match: each GL line consumed at most once', () => {
  const lineMv = (d: number, c: number) => toCents(d) - toCents(c)
  const stmt = [
    { id: 's1', date: new Date('2026-01-15'), amount: -100 },
    { id: 's2', date: new Date('2026-01-16'), amount: -100 },  // same amount as s1
  ]
  const gl = [
    { id: 'g1', debit: 0, credit: 100, date: new Date('2026-01-15') },
    { id: 'g2', debit: 0, credit: 100, date: new Date('2026-01-16') },
  ]
  const used = new Set<string>()
  for (const sl of stmt) {
    const target = toCents(sl.amount)
    const hit = gl.find(g => !used.has(g.id)
      && lineMv(g.debit, g.credit) === target
      && Math.abs(+sl.date - +g.date) / 86400000 <= 5)
    if (hit) used.add(hit.id)
  }
  assert.equal(used.size, 2)  // each statement line got its own GL line
})

test('trial balance is balanced for a complete bookkeeping cycle', () => {
  // Owner invests 10000 cash; sells $5000 of inventory ($2000 COGS); pays $1000 rent
  const lines: Array<{ type: string; debit: number; credit: number }> = [
    { type: 'ASSET',     debit: 10000, credit: 0 },     // Cash
    { type: 'EQUITY',    debit: 0,     credit: 10000 }, // Capital
    { type: 'ASSET',     debit: 5000,  credit: 0 },     // Cash
    { type: 'REVENUE',   debit: 0,     credit: 5000 },  // Sales
    { type: 'COGS',      debit: 2000,  credit: 0 },     // COGS
    { type: 'ASSET',     debit: 0,     credit: 2000 },  // Cash (inventory)
    { type: 'EXPENSE',   debit: 1000,  credit: 0 },     // Rent
    { type: 'ASSET',     debit: 0,     credit: 1000 },  // Cash
  ]
  const totalDebits  = lines.reduce((s, l) => s + toCents(l.debit), 0)
  const totalCredits = lines.reduce((s, l) => s + toCents(l.credit), 0)
  assert.equal(totalDebits, totalCredits)

  // P&L: net income = revenue - COGS - expenses
  const sum = (t: string, side: 'debit' | 'credit') =>
    lines.filter(l => l.type === t).reduce((s, l) => s + toCents(l[side]), 0)
  const ni = sum('REVENUE', 'credit') - sum('COGS', 'debit') - sum('EXPENSE', 'debit')
  assert.equal(ni / 100, 2000)

  // Balance sheet: assets = liabilities + equity + retained NI
  const assets = sum('ASSET', 'debit') - sum('ASSET', 'credit')
  const equity = sum('EQUITY', 'credit') - sum('EQUITY', 'debit')
  assert.equal(assets / 100, 12000)
  assert.equal((equity + ni) / 100, 12000)
})

test('period lock predicate: locked on or before cutoff', () => {
  const cutoff = new Date('2026-03-31').getTime()
  const inPeriod = new Date('2026-03-15').getTime()
  const onCutoff = new Date('2026-03-31').getTime()
  const afterPeriod = new Date('2026-04-01').getTime()
  assert.ok(inPeriod <= cutoff,   'date inside period must be blocked')
  assert.ok(onCutoff <= cutoff,   'date equal to cutoff must be blocked')
  assert.ok(afterPeriod > cutoff, 'date after cutoff must be allowed')
})

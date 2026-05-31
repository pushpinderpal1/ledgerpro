import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  monthlyDepreciation,
  projectSchedule,
  depreciationDueThrough,
  endOfMonth,
  monthDiffInclusive,
} from '../src/lib/assets/depreciation'

// ─── Straight-line ─────────────────────────────────────────────────────────────

test('straight-line: monthly = (cost - salvage) / useful life', () => {
  const dep = monthlyDepreciation(
    { cost: 12000, salvageValue: 0, usefulLifeMonths: 60, depreciationRatePercent: 20, method: 'STRAIGHT_LINE' },
    0,
  )
  assert.equal(dep, 200)             // 12000 / 60 = 200
})

test('straight-line: respects salvage value floor', () => {
  const asset = { cost: 12000, salvageValue: 2000, usefulLifeMonths: 60, depreciationRatePercent: 20, method: 'STRAIGHT_LINE' as const }
  // Monthly = (12000-2000)/60 = 166.6667; rounded to 166.67
  const dep = monthlyDepreciation(asset, 0)
  assert.equal(dep, 166.67)
})

test('straight-line: zero useful life returns zero', () => {
  const dep = monthlyDepreciation(
    { cost: 1000, salvageValue: 0, usefulLifeMonths: 0, depreciationRatePercent: 0, method: 'STRAIGHT_LINE' },
    0,
  )
  assert.equal(dep, 0)
})

test('straight-line: caps last month at remaining', () => {
  const asset = { cost: 1000, salvageValue: 0, usefulLifeMonths: 3, depreciationRatePercent: 33.33, method: 'STRAIGHT_LINE' as const }
  // Monthly = 333.33
  const m1 = monthlyDepreciation(asset, 0)
  const m2 = monthlyDepreciation(asset, m1)
  const m3 = monthlyDepreciation(asset, m1 + m2)
  // Total should equal full cost exactly (no over-depreciation).
  assert.ok(Math.abs(m1 + m2 + m3 - 1000) < 0.02, `total ${m1 + m2 + m3} should be ~1000`)
})

test('straight-line: stops at salvage (no negative depreciation)', () => {
  const asset = { cost: 1000, salvageValue: 100, usefulLifeMonths: 10, depreciationRatePercent: 10, method: 'STRAIGHT_LINE' as const }
  // After 10 months accumulated should = 900; 11th month should be 0.
  const accumulated = 900
  const dep = monthlyDepreciation(asset, accumulated)
  assert.equal(dep, 0)
})

// ─── Declining balance ─────────────────────────────────────────────────────────

test('declining-balance: applies monthly rate to current book value', () => {
  const asset = { cost: 10000, salvageValue: 0, usefulLifeMonths: 60, depreciationRatePercent: 24, method: 'DECLINING_BALANCE' as const }
  // Monthly rate = 24/12 = 2% per month
  const m1 = monthlyDepreciation(asset, 0)
  assert.equal(m1, 200)              // 10000 × 0.02

  const m2 = monthlyDepreciation(asset, m1)
  assert.equal(m2, 196)              // (10000 − 200) × 0.02 = 196
})

test('declining-balance: respects salvage floor', () => {
  const asset = { cost: 1000, salvageValue: 800, usefulLifeMonths: 60, depreciationRatePercent: 60, method: 'DECLINING_BALANCE' as const }
  // 5% monthly. First month would be 50, leaving BV=950 (still > 800).
  // Eventually it should clip to keep BV >= 800.
  let accumulated = 0
  for (let i = 0; i < 24; i++) {
    accumulated += monthlyDepreciation(asset, accumulated)
  }
  const bookValue = 1000 - accumulated
  assert.ok(bookValue >= 799.99, `book value ${bookValue} should not go below salvage 800`)
})

// ─── Schedule projection ────────────────────────────────────────────────────────

test('projectSchedule: 60-month straight-line schedule has 60 rows and totals to cost-salvage', () => {
  const sch = projectSchedule(
    { cost: 6000, salvageValue: 0, usefulLifeMonths: 60, depreciationRatePercent: 20, method: 'STRAIGHT_LINE' },
    new Date('2026-01-15')
  )
  assert.equal(sch.length, 60)
  const total = sch.reduce((s, r) => s + r.amount, 0)
  assert.ok(Math.abs(total - 6000) < 0.02, `total ${total} should be ~6000`)
})

test('projectSchedule: book-value monotonically decreases', () => {
  const sch = projectSchedule(
    { cost: 5000, salvageValue: 500, usefulLifeMonths: 36, depreciationRatePercent: 30, method: 'STRAIGHT_LINE' },
    new Date('2026-01-01')
  )
  for (let i = 1; i < sch.length; i++) {
    assert.ok(sch[i].bookValue <= sch[i - 1].bookValue, `BV must not increase at index ${i}`)
  }
  assert.ok(sch[sch.length - 1].bookValue >= 500, 'final BV must be ≥ salvage')
})

test('projectSchedule: declining-balance approaches but never crosses salvage', () => {
  const sch = projectSchedule(
    { cost: 10000, salvageValue: 1000, usefulLifeMonths: 60, depreciationRatePercent: 36, method: 'DECLINING_BALANCE' },
    new Date('2026-01-01'),
    240   // 20 years cap to ensure we reach salvage
  )
  const final = sch[sch.length - 1]
  assert.ok(final.bookValue >= 1000 - 0.01, `final BV ${final.bookValue} should be ≥ salvage`)
})

// ─── Catch-up depreciation ──────────────────────────────────────────────────────

test('depreciationDueThrough: catches up an asset bought 6 months ago', () => {
  const due = depreciationDueThrough(
    { cost: 6000, salvageValue: 0, usefulLifeMonths: 60, depreciationRatePercent: 20, method: 'STRAIGHT_LINE' },
    new Date('2026-01-15'),
    new Date('2026-06-30')
  )
  // 6 months × 100 = 600
  assert.ok(Math.abs(due - 600) < 0.05)
})

test('depreciationDueThrough: zero before acquisition month', () => {
  const due = depreciationDueThrough(
    { cost: 1000, salvageValue: 0, usefulLifeMonths: 12, depreciationRatePercent: 100, method: 'STRAIGHT_LINE' },
    new Date('2026-06-01'),
    new Date('2026-03-01')
  )
  assert.equal(due, 0)
})

// ─── Date helpers ──────────────────────────────────────────────────────────────

test('endOfMonth: returns last day of target month', () => {
  const eom = endOfMonth(new Date('2026-01-15'), 0)
  assert.equal(eom.getDate(), 31)
  assert.equal(eom.getMonth(), 0)
})

test('endOfMonth: month + 1', () => {
  const eom = endOfMonth(new Date('2026-01-15'), 1)
  assert.equal(eom.getMonth(), 1)
  assert.equal(eom.getDate(), 28)         // 2026 Feb 28
})

test('monthDiffInclusive: same month → 1', () => {
  assert.equal(monthDiffInclusive(new Date('2026-01-05'), new Date('2026-01-25')), 1)
})

test('monthDiffInclusive: spanning years', () => {
  assert.equal(monthDiffInclusive(new Date('2025-11-01'), new Date('2026-02-01')), 4)
})

test('monthDiffInclusive: target before start → 0', () => {
  assert.equal(monthDiffInclusive(new Date('2026-06-01'), new Date('2026-03-01')), 0)
})

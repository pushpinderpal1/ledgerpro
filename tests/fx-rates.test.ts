import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pickRate, convert, convertAmount, type FxRateRow } from '../src/lib/fx/rates'

const usdToEur = (rate: number, date: string): FxRateRow => ({
  fromCurrency: 'USD', toCurrency: 'EUR', rate, effectiveDate: new Date(date),
})

test('same-currency conversion returns 1', () => {
  const p = pickRate([], 'USD', 'USD', new Date('2026-05-01'))
  assert.equal(p.rate, 1)
  assert.equal(p.source, 'direct')
})

test('picks the rate active on the given date', () => {
  const rows = [
    usdToEur(0.90, '2026-01-01'),
    usdToEur(0.92, '2026-03-01'),
    usdToEur(0.95, '2026-06-01'),
  ]
  const p = pickRate(rows, 'USD', 'EUR', new Date('2026-04-15'))
  assert.equal(p.rate, 0.92)
})

test('picks the most recent rate when multiple are eligible', () => {
  const rows = [
    usdToEur(0.90, '2026-01-01'),
    usdToEur(0.92, '2026-03-01'),
  ]
  const p = pickRate(rows, 'USD', 'EUR', new Date('2026-12-31'))
  assert.equal(p.rate, 0.92)
})

test('uses inverse rate when only the reverse direction is stored', () => {
  // Only EUR→USD stored; we want USD→EUR
  const rows: FxRateRow[] = [{
    fromCurrency: 'EUR', toCurrency: 'USD', rate: 1.10, effectiveDate: new Date('2026-01-01'),
  }]
  const p = pickRate(rows, 'USD', 'EUR', new Date('2026-06-01'))
  assert.equal(p.source, 'inverse')
  assert.ok(Math.abs(p.rate - 1 / 1.10) < 1e-9)
})

test('throws when no rate exists for the date or earlier', () => {
  const rows = [usdToEur(0.92, '2026-06-01')]
  assert.throws(
    () => pickRate(rows, 'USD', 'EUR', new Date('2026-03-01')),
    /No FX rate available/
  )
})

test('throws when no rate exists for the pair at all', () => {
  const rows = [usdToEur(0.92, '2026-01-01')]
  assert.throws(
    () => pickRate(rows, 'GBP', 'INR', new Date('2026-06-01')),
    /No FX rate available/
  )
})

test('convert: applies rate and rounds to 2 decimal places', () => {
  // $10,000 at 0.92 = €9,200 (no rounding needed)
  assert.equal(convert(10000, 0.92), 9200)
  // $1234.56 at 1.137 = 1403.69472 → rounds to 1403.69
  assert.equal(convert(1234.56, 1.137), 1403.69)
})

test('convertAmount: full pipeline USD→EUR', () => {
  const rows = [usdToEur(0.92, '2026-01-01')]
  const r = convertAmount(10000, 'USD', 'EUR', new Date('2026-05-01'), rows)
  assert.equal(r.converted, 9200)
  assert.equal(r.rate, 0.92)
  assert.equal(r.source, 'direct')
})

test('convertAmount: cross-rate via inverse', () => {
  const rows: FxRateRow[] = [{
    fromCurrency: 'EUR', toCurrency: 'USD', rate: 1.10, effectiveDate: new Date('2026-01-01'),
  }]
  const r = convertAmount(1000, 'USD', 'EUR', new Date('2026-06-01'), rows)
  assert.equal(r.source, 'inverse')
  // 1000 USD × (1 / 1.10) ≈ 909.09 EUR
  assert.ok(Math.abs(r.converted - 909.09) < 0.01)
})

test('rates effective on the target date are eligible (inclusive)', () => {
  const rows = [usdToEur(0.95, '2026-05-31')]
  const p = pickRate(rows, 'USD', 'EUR', new Date('2026-05-31'))
  assert.equal(p.rate, 0.95)
})

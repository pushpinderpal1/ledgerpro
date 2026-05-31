import { test } from 'node:test'
import assert from 'node:assert/strict'

/**
 * Smoke tests for frankfurter response parsing — replicates the parsing
 * logic from src/lib/fx/fetch.ts without actually calling the network.
 *
 * The live implementation calls fetch(); these tests verify the shape we
 * expect from frankfurter and the post-processing logic.
 */

interface FrankfurterResponse {
  amount: number
  base: string
  date: string
  rates: Record<string, number>
}

const sampleResponse: FrankfurterResponse = {
  amount: 1.0,
  base: 'USD',
  date: '2026-05-29',
  rates: {
    EUR: 0.9234,
    GBP: 0.7891,
    INR: 83.17,
    JPY: 156.45,
    CAD: 1.3622,
  },
}

test('parses base currency and effective date', () => {
  const date = new Date(sampleResponse.date)
  assert.equal(sampleResponse.base, 'USD')
  assert.equal(date.toISOString().slice(0, 10), '2026-05-29')
  assert.equal(Object.keys(sampleResponse.rates).length, 5)
})

test('detects unsupported requested currencies', () => {
  const requested = ['EUR', 'GBP', 'AED', 'KWD']        // AED, KWD not in sample
  const unsupported = requested.filter(c => !(c in sampleResponse.rates) && c !== sampleResponse.base)
  assert.deepEqual(unsupported, ['AED', 'KWD'])
})

test('builds upsert candidates for each rate', () => {
  const base = sampleResponse.base
  const effectiveDate = new Date(sampleResponse.date)
  const candidates = Object.entries(sampleResponse.rates).map(([target, rate]) => ({
    fromCurrency: base,
    toCurrency: target,
    rate,
    effectiveDate,
  }))
  assert.equal(candidates.length, 5)
  const eur = candidates.find(c => c.toCurrency === 'EUR')!
  assert.equal(eur.fromCurrency, 'USD')
  assert.equal(eur.rate, 0.9234)
})

test('manual-override semantics: pre-existing manual entries should be skipped', () => {
  // Simulated DB state: USD→EUR has a manual rate; USD→GBP doesn't.
  const existing = new Map<string, { source: string }>([
    ['USD|EUR|2026-05-29', { source: 'manual' }],
    ['USD|GBP|2026-05-29', { source: 'frankfurter.app' }],   // can be overwritten
  ])
  const base = 'USD'
  const dateStr = '2026-05-29'
  const decisions: { pair: string; action: 'skip' | 'upsert' }[] = []
  for (const target of Object.keys(sampleResponse.rates)) {
    const key = `${base}|${target}|${dateStr}`
    const e = existing.get(key)
    if (e && e.source === 'manual') {
      decisions.push({ pair: `${base}/${target}`, action: 'skip' })
    } else {
      decisions.push({ pair: `${base}/${target}`, action: 'upsert' })
    }
  }
  const skipped = decisions.filter(d => d.action === 'skip')
  assert.equal(skipped.length, 1)
  assert.equal(skipped[0].pair, 'USD/EUR')
})

test('weekend dates: response date may differ from requested', () => {
  // Saturday 2026-05-30 → ECB returns Friday 2026-05-29
  const requested = '2026-05-30'
  const returned = sampleResponse.date  // '2026-05-29'
  assert.notEqual(requested, returned)
  // The fetcher uses the returned date for effectiveDate, not the requested one.
})

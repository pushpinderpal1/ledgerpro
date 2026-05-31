/**
 * Pure FX conversion math. No DB dependency.
 *
 * Conventions:
 *  - A rate row {fromCurrency: 'USD', toCurrency: 'EUR', rate: 0.92} means
 *    1 USD = 0.92 EUR.
 *  - When converting in the opposite direction we use 1 / rate (no separate
 *    inverse row required).
 *  - Picking a rate for a date: choose the row with the largest
 *    effectiveDate <= the target date. If none exists, throw.
 *  - All amounts rounded to 2 decimal places at the output boundary.
 */

export interface FxRateRow {
  fromCurrency: string
  toCurrency: string
  rate: number
  effectiveDate: Date
}

const round2 = (n: number) => Math.round(n * 100) / 100

/** Find the applicable rate for converting `from → to` as of `asOf`. */
export function pickRate(
  rows: FxRateRow[],
  from: string,
  to: string,
  asOf: Date,
): { rate: number; source: 'direct' | 'inverse'; effectiveDate: Date } {
  if (from === to) return { rate: 1, source: 'direct', effectiveDate: asOf }

  const direct = bestRow(rows, from, to, asOf)
  if (direct) return { rate: Number(direct.rate), source: 'direct', effectiveDate: direct.effectiveDate }

  // Try the inverse pair.
  const inverse = bestRow(rows, to, from, asOf)
  if (inverse) {
    return {
      rate: 1 / Number(inverse.rate),
      source: 'inverse',
      effectiveDate: inverse.effectiveDate,
    }
  }

  throw new Error(`No FX rate available for ${from} → ${to} on or before ${asOf.toISOString().slice(0, 10)}`)
}

function bestRow(rows: FxRateRow[], from: string, to: string, asOf: Date): FxRateRow | null {
  let best: FxRateRow | null = null
  for (const r of rows) {
    if (r.fromCurrency !== from || r.toCurrency !== to) continue
    if (new Date(r.effectiveDate).getTime() > asOf.getTime()) continue
    if (!best || new Date(r.effectiveDate).getTime() > new Date(best.effectiveDate).getTime()) {
      best = r
    }
  }
  return best
}

/** Convert an amount with the picked rate. Output rounded to 2 dp. */
export function convert(amount: number, rate: number): number {
  return round2(amount * rate)
}

/** Convert via lookup — convenience that combines pickRate + convert. */
export function convertAmount(
  amount: number,
  from: string,
  to: string,
  asOf: Date,
  rows: FxRateRow[],
): { converted: number; rate: number; effectiveDate: Date; source: 'direct' | 'inverse' } {
  const picked = pickRate(rows, from, to, asOf)
  return { converted: convert(amount, picked.rate), ...picked }
}

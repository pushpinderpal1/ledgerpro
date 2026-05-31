import { db } from '../db'
import { pickRate, convert, type FxRateRow } from './rates'

/**
 * DB-backed FX helpers. Loads candidate rate rows from the database, then
 * delegates to the pure pickRate / convert functions for the actual math.
 *
 * Caching: lookups are per-request. We don't cache because rates change and
 * the table is small (hundreds of rows even for a large group).
 */

export async function getRateOn(
  from: string,
  to: string,
  asOf: Date,
): Promise<{ rate: number; effectiveDate: Date; source: 'direct' | 'inverse' }> {
  if (from === to) return { rate: 1, effectiveDate: asOf, source: 'direct' }

  // Load candidate rows for either direction up to and including asOf.
  const rows = await db.fxRate.findMany({
    where: {
      OR: [
        { fromCurrency: from, toCurrency: to,   effectiveDate: { lte: asOf } },
        { fromCurrency: to,   toCurrency: from, effectiveDate: { lte: asOf } },
      ],
    },
    orderBy: { effectiveDate: 'desc' },
    take: 10,                                          // plenty of headroom
    select: { fromCurrency: true, toCurrency: true, rate: true, effectiveDate: true },
  })

  const rateRows: FxRateRow[] = rows.map(r => ({
    fromCurrency: r.fromCurrency,
    toCurrency: r.toCurrency,
    rate: Number(r.rate),
    effectiveDate: r.effectiveDate,
  }))

  return pickRate(rateRows, from, to, asOf)
}

export async function convertOn(
  amount: number,
  from: string,
  to: string,
  asOf: Date,
): Promise<{ converted: number; rate: number; effectiveDate: Date; source: 'direct' | 'inverse' }> {
  const picked = await getRateOn(from, to, asOf)
  return { converted: convert(amount, picked.rate), ...picked }
}

/** Upsert one rate row. Manual entries go through here. */
export async function upsertRate(input: {
  fromCurrency: string
  toCurrency: string
  rate: number
  effectiveDate: Date
  source?: string
  notes?: string
  createdBy?: string
}) {
  const { fromCurrency, toCurrency, effectiveDate, ...rest } = input
  return db.fxRate.upsert({
    where: { fromCurrency_toCurrency_effectiveDate: { fromCurrency, toCurrency, effectiveDate } },
    update: { rate: rest.rate, source: rest.source ?? null, notes: rest.notes ?? null },
    create: { fromCurrency, toCurrency, effectiveDate, ...rest, source: rest.source ?? 'manual' },
  })
}

/** Distinct currency pairs in use (for the FX-rates list view). */
export async function listAllRates(opts: { from?: string; to?: string; limit?: number } = {}) {
  return db.fxRate.findMany({
    where: {
      ...(opts.from ? { fromCurrency: opts.from } : {}),
      ...(opts.to   ? { toCurrency: opts.to   } : {}),
    },
    orderBy: [{ fromCurrency: 'asc' }, { toCurrency: 'asc' }, { effectiveDate: 'desc' }],
    take: opts.limit ?? 200,
  })
}

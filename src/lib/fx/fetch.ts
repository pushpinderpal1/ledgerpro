import { db } from '../db'

/**
 * Fetches FX rates from frankfurter.app — a free, no-API-key service backed by
 * the European Central Bank reference rates. Updated each business day around
 * 16:00 CET. No rate limits, but the data is ECB-sourced, so:
 *
 *  - ~30 major currencies (USD, EUR, GBP, CAD, AUD, INR, JPY, CNY, SGD, CHF,
 *    HKD, KRW, BRL, MXN, etc. — see https://www.frankfurter.app/docs)
 *  - **No weekend rates** — Friday's rate is returned when asking for Saturday
 *    or Sunday. The response says which date was actually used.
 *  - Some currencies are unsupported (AED, the GCC pegs). Those have to stay
 *    on manual entry.
 *
 * Manual entries are never overwritten. If a row exists with source='manual'
 * for the same (fromCurrency, toCurrency, effectiveDate), the fetcher skips it.
 */

const FRANKFURTER_BASE = 'https://api.frankfurter.app'

export interface FetchedRate {
  fromCurrency: string
  toCurrency: string
  rate: number
  effectiveDate: Date
}

export interface FetchResult {
  source: 'frankfurter.app'
  base: string
  effectiveDate: Date           // the date returned by ECB (may differ from requested)
  requestedDate: Date
  inserted: number
  skipped: { fromCurrency: string; toCurrency: string; reason: string }[]
  unsupported: string[]         // currencies user asked for that aren't published
}

/**
 * Fetch rates from frankfurter and upsert them, respecting manual overrides.
 *
 *   base       — base currency (e.g. 'USD')
 *   targets    — list of target currencies; if omitted, fetches ALL available
 *   date       — ISO date string or Date; default 'latest'
 *   createdBy  — userId for the audit trail
 */
export async function fetchFromFrankfurter(input: {
  base: string
  targets?: string[]
  date?: string | Date
  createdBy?: string
}): Promise<FetchResult> {
  const base = input.base.toUpperCase()

  // Build URL. Frankfurter accepts 'latest' OR a YYYY-MM-DD path segment.
  const dateSegment = !input.date || input.date === 'latest'
    ? 'latest'
    : typeof input.date === 'string'
      ? input.date
      : input.date.toISOString().slice(0, 10)

  const params = new URLSearchParams({ from: base })
  if (input.targets && input.targets.length > 0) {
    params.set('to', input.targets.map(t => t.toUpperCase()).filter(t => t !== base).join(','))
  }
  const url = `${FRANKFURTER_BASE}/${dateSegment}?${params}`

  let response: Response
  try {
    response = await fetch(url, {
      // Conservative timeout — frankfurter is usually fast but we don't want to hang.
      signal: AbortSignal.timeout(15_000),
      headers: { 'User-Agent': 'LedgerPro/1.0 (ledgerpro.app)' },
    })
  } catch (e) {
    throw new Error(`Could not reach frankfurter.app: ${(e as Error).message}`)
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`frankfurter.app returned ${response.status}: ${text.slice(0, 200)}`)
  }

  const data = await response.json() as { amount: number; base: string; date: string; rates: Record<string, number> }
  if (!data.rates || typeof data.rates !== 'object') {
    throw new Error('Unexpected response from frankfurter.app')
  }

  const effectiveDate = new Date(data.date)
  const requestedDate = typeof input.date === 'string' ? new Date(input.date)
                       : input.date instanceof Date ? input.date
                       : new Date()

  // Detect unsupported currencies the user asked for.
  const unsupported: string[] = []
  if (input.targets) {
    for (const t of input.targets) {
      const code = t.toUpperCase()
      if (code === base) continue
      if (!(code in data.rates)) unsupported.push(code)
    }
  }

  // Upsert each pair, respecting manual overrides.
  let inserted = 0
  const skipped: FetchResult['skipped'] = []
  for (const [target, rate] of Object.entries(data.rates)) {
    const existing = await db.fxRate.findUnique({
      where: {
        fromCurrency_toCurrency_effectiveDate: {
          fromCurrency: base,
          toCurrency: target,
          effectiveDate,
        },
      },
    })
    if (existing && existing.source === 'manual') {
      skipped.push({ fromCurrency: base, toCurrency: target, reason: 'manual override exists' })
      continue
    }
    await db.fxRate.upsert({
      where: {
        fromCurrency_toCurrency_effectiveDate: {
          fromCurrency: base,
          toCurrency: target,
          effectiveDate,
        },
      },
      update: { rate: Number(rate), source: 'frankfurter.app' },
      create: {
        fromCurrency: base,
        toCurrency: target,
        rate: Number(rate),
        effectiveDate,
        source: 'frankfurter.app',
        createdBy: input.createdBy,
      },
    })
    inserted++
  }

  return {
    source: 'frankfurter.app',
    base,
    effectiveDate,
    requestedDate,
    inserted,
    skipped,
    unsupported,
  }
}

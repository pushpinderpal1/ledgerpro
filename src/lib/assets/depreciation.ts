/**
 * Depreciation math — pure functions, no DB dependency.
 *
 * Conventions:
 *  - All amounts are in *integer cents* internally to avoid float drift.
 *  - Public functions take/return number (dollars) for convenience.
 *  - Periods are calendar months. Acquisition month is depreciated in full
 *    (mid-month convention is also defined below for users who need it).
 *  - Depreciation stops at the salvage value floor.
 */

const toCents = (n: number) => Math.round(n * 100)
const fromCents = (c: number) => c / 100

export type DepreciationMethod = 'STRAIGHT_LINE' | 'DECLINING_BALANCE'

export interface AssetSpec {
  cost: number
  salvageValue: number
  usefulLifeMonths: number
  depreciationRatePercent: number   // annual rate
  method: DepreciationMethod
}

/**
 * Monthly depreciation for one period given current accumulated depreciation.
 *
 * Returns the depreciation amount that should be booked this month.
 * Always caps so book-value (cost - accumulated - dep) >= salvage.
 */
export function monthlyDepreciation(
  asset: AssetSpec,
  accumulatedBefore: number
): number {
  const costCents = toCents(asset.cost)
  const salvageCents = toCents(asset.salvageValue)
  const accumCents = toCents(accumulatedBefore)
  const bookCents = costCents - accumCents
  const depreciableRemainingCents = Math.max(0, bookCents - salvageCents)

  if (depreciableRemainingCents === 0) return 0

  let depCents: number
  if (asset.method === 'STRAIGHT_LINE') {
    if (asset.usefulLifeMonths <= 0) return 0
    const totalDepreciableCents = costCents - salvageCents
    depCents = Math.round(totalDepreciableCents / asset.usefulLifeMonths)
  } else {
    // Declining balance: monthly rate = annual / 12 applied to current book value.
    // This intentionally uses simple division (not geometric) to match common
    // accounting practice and remain predictable to users.
    const monthlyRate = asset.depreciationRatePercent / 100 / 12
    depCents = Math.round(bookCents * monthlyRate)
  }

  // Floor: never cross salvage in a single month.
  if (depCents > depreciableRemainingCents) depCents = depreciableRemainingCents
  return fromCents(depCents)
}

/**
 * Project the full depreciation schedule for an asset, starting from
 * `acquisitionDate` until book value reaches salvage (or `maxMonths`).
 *
 * Returns an array of { period, dep, accumulated, bookValue } rows.
 * Useful for asset detail screens and for verifying a single-month run.
 */
export interface ScheduleRow {
  monthIndex: number          // 0 = acquisition month
  periodEnd: Date             // last day of the month
  amount: number
  accumulated: number
  bookValue: number
}

export function projectSchedule(
  asset: AssetSpec,
  acquisitionDate: Date,
  maxMonths: number = 600     // safety cap (50 years)
): ScheduleRow[] {
  const out: ScheduleRow[] = []
  let accumulated = 0
  let i = 0
  while (i < maxMonths) {
    const periodEnd = endOfMonth(acquisitionDate, i)
    const dep = monthlyDepreciation(asset, accumulated)
    if (dep === 0) break
    accumulated += dep
    const bookValue = asset.cost - accumulated
    out.push({ monthIndex: i, periodEnd, amount: dep, accumulated, bookValue })
    i++
    if (bookValue <= asset.salvageValue + 0.005) break
  }
  return out
}

/**
 * Sum of depreciation that *should have been* taken from acquisition through
 * a target period end, assuming a steady monthly cadence. Used when running
 * depreciation for the first time on an asset that's been around a while —
 * the engine catches up to where the asset should be.
 */
export function depreciationDueThrough(
  asset: AssetSpec,
  acquisitionDate: Date,
  through: Date
): number {
  // Number of full months from acquisition (inclusive) through `through`.
  const months = monthDiffInclusive(acquisitionDate, through)
  if (months <= 0) return 0
  const schedule = projectSchedule(asset, acquisitionDate, months)
  if (schedule.length === 0) return 0
  return schedule[schedule.length - 1].accumulated
}

// ─── date helpers ──────────────────────────────────────────────────────────────

/** Returns the last day (date-only) of the month `n` months after `start`. */
export function endOfMonth(start: Date, n: number = 0): Date {
  const d = new Date(start.getFullYear(), start.getMonth() + n + 1, 0)
  d.setHours(0, 0, 0, 0)
  return d
}

/**
 * Inclusive month count between two dates. Same month → 1; next month → 2; etc.
 * Returns 0 if `to` is before `from`'s month.
 */
export function monthDiffInclusive(from: Date, to: Date): number {
  const years = to.getFullYear() - from.getFullYear()
  const months = to.getMonth() - from.getMonth()
  return Math.max(0, years * 12 + months + 1)
}

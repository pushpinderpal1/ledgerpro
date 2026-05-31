import { db } from '../db'
import { assertDateUnlocked } from '../periods'
import {
  monthlyDepreciation,
  depreciationDueThrough,
  endOfMonth,
  type AssetSpec,
} from './depreciation'

/**
 * Fixed-asset engine. Handles asset creation, monthly depreciation runs,
 * and disposal — all with period-lock-aware GL postings.
 *
 * Postings:
 *   On depreciation run for a period:
 *     DR Depreciation Expense (per category sum)
 *     CR Accumulated Depreciation (per category sum)
 *   On disposal:
 *     DR Cash/Bank (proceeds)
 *     DR Accumulated Depreciation (to remove all dep against the asset)
 *     CR Fixed Asset (to remove the cost)
 *     DR/CR Gain or Loss on Disposal (the balancing figure)
 *
 * All amounts use integer-cent math against Decimal(18,2).
 */

const toCents = (n: unknown) => Math.round(Number(n ?? 0) * 100)
const fromCents = (c: number) => c / 100

// ─── Asset CRUD helpers (the API route handles them; this is the engine for runs) ──

export async function getAssetWithAccum(assetId: string, entityId: string) {
  const asset = await db.fixedAsset.findFirst({
    where: { id: assetId, entityId },
    include: {
      category: true,
      depreciationEntries: { select: { amount: true } },
    },
  })
  if (!asset) throw new Error('Asset not found')
  const accumulated = asset.depreciationEntries.reduce((s, e) => s + Number(e.amount), 0)
  return { asset, accumulated, bookValue: Number(asset.cost) - accumulated }
}

// ─── Run depreciation for a period ────────────────────────────────────────────
// Idempotent per (asset, periodEnd) — re-running for the same period skips
// any asset that already has a DepreciationEntry for that period.
export async function runDepreciation(input: {
  entityId: string
  periodEnd: Date              // last day of the month being depreciated
  userId?: string
  // If `catchUp` is true and an asset has no prior dep entries but was
  // acquired before `periodEnd`, calculate cumulative depreciation due and
  // book it in this run (useful for first run on legacy data).
  catchUp?: boolean
}) {
  await assertDateUnlocked(input.entityId, input.periodEnd)

  // Normalize to end-of-month at midnight UTC.
  const periodEnd = new Date(input.periodEnd)
  periodEnd.setHours(0, 0, 0, 0)

  const assets = await db.fixedAsset.findMany({
    where: {
      entityId: input.entityId,
      status: 'ACTIVE',
      acquisitionDate: { lte: periodEnd },
    },
    include: {
      category: true,
      depreciationEntries: { select: { amount: true, periodEnd: true } },
    },
  })

  // Filter out assets that already have an entry for this period.
  const candidates = assets.filter((a) => !a.depreciationEntries.some(
    (e) => sameMonth(new Date(e.periodEnd), periodEnd)
  ))

  if (candidates.length === 0) {
    return { runFor: periodEnd, assetsProcessed: 0, totalDepreciation: 0, journalEntryId: null }
  }

  // Compute per-asset depreciation.
  const computations: {
    asset: typeof candidates[number]
    amount: number
    bookValueAfter: number
  }[] = []

  for (const asset of candidates) {
    const spec: AssetSpec = {
      cost: Number(asset.cost),
      salvageValue: Number(asset.salvageValue),
      usefulLifeMonths: asset.usefulLifeMonths,
      depreciationRatePercent: Number(asset.depreciationRatePercent),
      method: asset.depreciationMethod,
    }
    const accumulated = asset.depreciationEntries.reduce((s, e) => s + Number(e.amount), 0)

    let amount: number
    if (input.catchUp && asset.depreciationEntries.length === 0) {
      // Catch up: amount = total dep due through periodEnd minus already-booked.
      amount = depreciationDueThrough(spec, new Date(asset.acquisitionDate), periodEnd)
    } else {
      amount = monthlyDepreciation(spec, accumulated)
    }

    if (amount <= 0) continue
    const bookValueAfter = Number(asset.cost) - accumulated - amount
    computations.push({ asset, amount, bookValueAfter })
  }

  if (computations.length === 0) {
    return { runFor: periodEnd, assetsProcessed: 0, totalDepreciation: 0, journalEntryId: null }
  }

  // Group by (depExpenseAccountId, accumDepAccountId) so the JE has at most
  // one debit + credit pair per category.
  type GroupKey = string
  const groups = new Map<GroupKey, { depExpenseId: string; accumDepId: string; totalCents: number; assetIds: string[] }>()
  for (const c of computations) {
    const key = `${c.asset.category.depExpenseAccountId}|${c.asset.category.accumDepAccountId}`
    const g = groups.get(key) ?? {
      depExpenseId: c.asset.category.depExpenseAccountId,
      accumDepId: c.asset.category.accumDepAccountId,
      totalCents: 0,
      assetIds: [],
    }
    g.totalCents += toCents(c.amount)
    g.assetIds.push(c.asset.assetNo)
    groups.set(key, g)
  }

  // Atomic posting + entry creation.
  return db.$transaction(async (tx) => {
    const count = await tx.journalEntry.count({ where: { entityId: input.entityId } })
    const ref = `DEPR-${periodEnd.getFullYear()}-${String(periodEnd.getMonth() + 1).padStart(2, '0')}-${String(count + 1).padStart(4, '0')}`

    const lines: { accountId: string; description: string; debit: number; credit: number; lineOrder: number }[] = []
    let totalCents = 0
    let order = 0
    for (const g of groups.values()) {
      totalCents += g.totalCents
      lines.push({
        accountId: g.depExpenseId,
        description: `Depreciation ${periodEnd.toISOString().slice(0, 7)} (${g.assetIds.length} asset${g.assetIds.length === 1 ? '' : 's'})`,
        debit: fromCents(g.totalCents),
        credit: 0,
        lineOrder: order++,
      })
      lines.push({
        accountId: g.accumDepId,
        description: `Depreciation ${periodEnd.toISOString().slice(0, 7)}`,
        debit: 0,
        credit: fromCents(g.totalCents),
        lineOrder: order++,
      })
    }

    const entry = await tx.journalEntry.create({
      data: {
        entityId: input.entityId,
        ref,
        date: periodEnd,
        description: `Depreciation for ${periodEnd.toISOString().slice(0, 7)}`,
        status: 'POSTED',
        source: 'DEPRECIATION',
        postedAt: new Date(),
        createdBy: input.userId,
        lines: { create: lines },
      },
    })

    // Create per-asset DepreciationEntry rows linking to this shared JE.
    await tx.depreciationEntry.createMany({
      data: computations.map((c) => ({
        fixedAssetId: c.asset.id,
        entityId: input.entityId,
        periodEnd,
        amount: c.amount,
        bookValueAfter: c.bookValueAfter,
        journalEntryId: entry.id,
      })),
    })

    // Mark fully-depreciated assets (book value ≤ salvage).
    for (const c of computations) {
      if (c.bookValueAfter <= Number(c.asset.salvageValue) + 0.005) {
        await tx.fixedAsset.update({
          where: { id: c.asset.id },
          data: { status: 'FULLY_DEPRECIATED' },
        })
      }
    }

    return {
      runFor: periodEnd,
      assetsProcessed: computations.length,
      totalDepreciation: fromCents(totalCents),
      journalEntryId: entry.id,
      ref,
    }
  })
}

// ─── Dispose an asset ─────────────────────────────────────────────────────────
// Books the gain/loss and reverses the asset out of the books.
//   DR Bank/Cash (proceeds, if any)
//   DR Accumulated Depreciation (to wipe out accum against this asset)
//   CR Fixed Asset (to wipe out cost)
//   DR/CR Gain or Loss (balancing)
export async function disposeAsset(input: {
  entityId: string
  assetId: string
  disposalDate: Date
  proceeds: number
  proceedsAccountId: string                   // bank/cash/AR account to debit
  gainLossAccountId: string                   // typically an "Other Income" or "Other Expense" account
  userId?: string
}) {
  await assertDateUnlocked(input.entityId, input.disposalDate)

  return db.$transaction(async (tx) => {
    const asset = await tx.fixedAsset.findFirst({
      where: { id: input.assetId, entityId: input.entityId },
      include: { category: true, depreciationEntries: { select: { amount: true } } },
    })
    if (!asset) throw new Error('Asset not found')
    if (asset.status === 'DISPOSED') throw new Error('Asset is already disposed')

    const costCents = toCents(asset.cost)
    const accumulatedCents = asset.depreciationEntries.reduce((s, e) => s + toCents(e.amount), 0)
    const proceedsCents = toCents(input.proceeds)
    const bookValueCents = costCents - accumulatedCents

    // Gain (positive) or loss (negative). DR side if loss, CR side if gain.
    const gainCents = proceedsCents - bookValueCents

    const count = await tx.journalEntry.count({ where: { entityId: input.entityId } })
    const ref = `DISP-${input.disposalDate.getFullYear()}-${String(count + 1).padStart(4, '0')}`

    const lines: { accountId: string; description: string; debit: number; credit: number; lineOrder: number }[] = []
    let order = 0

    if (proceedsCents > 0) {
      lines.push({ accountId: input.proceedsAccountId, description: `Disposal proceeds: ${asset.assetNo}`, debit: fromCents(proceedsCents), credit: 0, lineOrder: order++ })
    }
    if (accumulatedCents > 0) {
      lines.push({ accountId: asset.category.accumDepAccountId, description: `Reverse accum dep: ${asset.assetNo}`, debit: fromCents(accumulatedCents), credit: 0, lineOrder: order++ })
    }
    lines.push({ accountId: asset.category.assetAccountId, description: `Dispose: ${asset.assetNo}`, debit: 0, credit: fromCents(costCents), lineOrder: order++ })

    // Gain (credit) or loss (debit) to balance.
    if (gainCents > 0) {
      lines.push({ accountId: input.gainLossAccountId, description: `Gain on disposal: ${asset.assetNo}`, debit: 0, credit: fromCents(gainCents), lineOrder: order++ })
    } else if (gainCents < 0) {
      lines.push({ accountId: input.gainLossAccountId, description: `Loss on disposal: ${asset.assetNo}`, debit: fromCents(-gainCents), credit: 0, lineOrder: order++ })
    }

    const entry = await tx.journalEntry.create({
      data: {
        entityId: input.entityId,
        ref,
        date: input.disposalDate,
        description: `Disposal of ${asset.assetNo} — ${asset.description}`,
        status: 'POSTED',
        source: 'ASSET_DISPOSAL',
        postedAt: new Date(),
        createdBy: input.userId,
        lines: { create: lines },
      },
    })

    await tx.fixedAsset.update({
      where: { id: input.assetId },
      data: {
        status: 'DISPOSED',
        disposalDate: input.disposalDate,
        disposalProceeds: input.proceeds,
      },
    })

    return {
      asset: input.assetId,
      proceeds: input.proceeds,
      bookValueAtDisposal: fromCents(bookValueCents),
      gainOrLoss: fromCents(gainCents),
      journalEntryId: entry.id,
      ref,
    }
  })
}

// ─── helpers ──────────────────────────────────────────────────────────────────
function sameMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()
}

// Re-export endOfMonth for the API route to normalize period inputs.
export { endOfMonth }

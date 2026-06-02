import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireEntityAccess } from '@/lib/auth'

/**
 * GET /api/reports/drilldown
 *
 * Returns the journal lines underlying a specific cell in a report — used
 * when the user clicks a number in TB / P&L / BS to see what made it up.
 *
 * Query parameters:
 *   entityId    (required) — entity to filter to
 *   accountId   (required) — the account to drill into
 *   from, to    (optional) — date window
 *   asOf        (optional) — cumulative-to-date (for Balance Sheet rows)
 *
 * Either (from + to) or asOf must be present.
 *
 * Returns:
 *   {
 *     account: { code, name, type },
 *     lines: [{
 *       id, date, ref, description, debit, credit, lineDescription,
 *       entry: { id, ref, status, description },
 *       runningBalance      // type-aware running balance through this line
 *     }],
 *     openingBalance, closingBalance, totalDebit, totalCredit
 *   }
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const entityId = sp.get('entityId')
  const accountId = sp.get('accountId')
  if (!entityId || !accountId) return NextResponse.json({ error: 'entityId, accountId required' }, { status: 400 })

  const auth = await requireEntityAccess(req, entityId, 'journals:read')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const account = await db.account.findFirst({
    where: { id: accountId, entityId },
    select: { id: true, code: true, name: true, type: true, subType: true },
  })
  if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 })

  // Parse the date window. The caller passes one of:
  //   from + to   → activity window (P&L / TB)
  //   asOf        → cumulative through asOf (BS)
  const fromStr = sp.get('from'), toStr = sp.get('to'), asOfStr = sp.get('asOf')
  let from: Date | undefined, to: Date | undefined
  if (asOfStr) {
    to = new Date(asOfStr)
    to.setHours(23, 59, 59, 999)
  } else if (fromStr && toStr) {
    from = new Date(fromStr)
    to = new Date(toStr)
    to.setHours(23, 59, 59, 999)
  } else {
    return NextResponse.json({ error: 'either from+to or asOf required' }, { status: 400 })
  }

  // For BS-style (cumulative) drills, compute opening balance up to `from`.
  // For activity-window drills, opening balance is cumulative up to `from-1`.
  let openingBalance = 0
  if (from) {
    const openingLines = await db.journalLine.findMany({
      where: {
        accountId,
        entry: { entityId, status: 'POSTED', date: { lt: from } },
      },
      select: { debit: true, credit: true },
    })
    for (const l of openingLines) openingBalance += Number(l.debit) - Number(l.credit)
  }

  // The lines being drilled to
  const lines = await db.journalLine.findMany({
    where: {
      accountId,
      entry: {
        entityId, status: 'POSTED',
        date: from ? { gte: from, lte: to } : { lte: to },
      },
    },
    include: {
      entry: { select: { id: true, ref: true, date: true, description: true, status: true } },
    },
    orderBy: [{ entry: { date: 'asc' } }, { entry: { ref: 'asc' } }, { lineOrder: 'asc' }],
  })

  let running = openingBalance
  let totalDebit = 0, totalCredit = 0
  const enriched = lines.map(l => {
    const d = Number(l.debit), c = Number(l.credit)
    running += d - c
    totalDebit += d
    totalCredit += c
    return {
      id: l.id,
      date: l.entry.date,
      ref: l.entry.ref,
      entryId: l.entry.id,
      entryDescription: l.entry.description,
      entryStatus: l.entry.status,
      lineDescription: l.description,
      debit: d,
      credit: c,
      runningBalance: running,
    }
  })

  return NextResponse.json({
    account,
    openingBalance,
    closingBalance: running,
    totalDebit,
    totalCredit,
    lineCount: enriched.length,
    lines: enriched,
  })
}

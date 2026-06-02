import { NextRequest, NextResponse } from 'next/server'
import { requireEntityAccess } from '@/lib/auth'
import {
  trialBalance,
  profitAndLoss,
  profitAndLossComparison,
  balanceSheet,
  generalLedger,
  apAging,
  apAgingDetail,
  cashFlows,
  journalReport,
  expensesByVendor,
  profitAndLossByDepartment,
  trialBalanceByDepartment,
} from '@/lib/reports'

/**
 * GET /api/reports?entityId=&type=&from=&to=&accountId=&asOf=&compare=
 *
 * type ∈ trial-balance | pnl | pnl-comparison | balance-sheet | general-ledger
 *      | ap-aging | ap-aging-detail | cash-flows | journal | expenses-by-vendor
 *
 * Reports are derived from POSTED journal entries only. Read access requires
 * at least AUDITOR-level visibility (journals:read), matching the rest of the
 * reporting surface.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const entityId = searchParams.get('entityId')
  const type = searchParams.get('type')

  if (!entityId) return NextResponse.json({ error: 'entityId required' }, { status: 400 })
  if (!type) return NextResponse.json({ error: 'type required' }, { status: 400 })

  const auth = await requireEntityAccess(req, entityId, 'journals:read')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const parseDate = (key: string): Date | undefined => {
    const v = searchParams.get(key)
    if (!v) return undefined
    const d = new Date(v)
    return isNaN(d.getTime()) ? undefined : d
  }

  const from = parseDate('from')
  const to = parseDate('to')
  const asOf = parseDate('asOf')

  try {
    switch (type) {
      case 'trial-balance':
        return NextResponse.json(await trialBalance(entityId, { from, to }))

      case 'pnl':
      case 'profit-loss':
        return NextResponse.json(await profitAndLoss(entityId, { from, to }))

      case 'pnl-comparison':
      case 'profit-loss-comparison':
        if (!from || !to) {
          return NextResponse.json({ error: 'from and to required' }, { status: 400 })
        }
        return NextResponse.json(await profitAndLossComparison(entityId, { from, to }))

      case 'balance-sheet':
        return NextResponse.json(await balanceSheet(entityId, asOf ?? to))

      case 'cash-flows':
      case 'statement-of-cash-flows':
        return NextResponse.json(await cashFlows(entityId, { from, to }))

      case 'general-ledger':
        return NextResponse.json(
          await generalLedger(entityId, {
            accountId: searchParams.get('accountId') ?? undefined,
            from,
            to,
          })
        )

      case 'journal':
      case 'journal-report':
        return NextResponse.json(await journalReport(entityId, { from, to }))

      case 'ap-aging':
        return NextResponse.json(await apAging(entityId, asOf ?? new Date()))

      case 'ap-aging-detail':
        return NextResponse.json(await apAgingDetail(entityId, asOf ?? new Date()))

      case 'expenses-by-vendor':
        return NextResponse.json(await expensesByVendor(entityId, { from, to }))

      case 'pnl-by-department':
        return NextResponse.json(await profitAndLossByDepartment(entityId, { from, to }))

      case 'trial-balance-by-department':
        return NextResponse.json(await trialBalanceByDepartment(entityId, { from, to }))

      default:
        return NextResponse.json({ error: `Unknown report type: ${type}` }, { status: 400 })
    }
  } catch (e) {
    console.error('[reports] error:', e)
    return NextResponse.json({ error: 'Failed to generate report' }, { status: 500 })
  }
}

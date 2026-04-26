import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireEntityAccess } from '@/lib/auth'

// GET /api/budget?entityId=&fiscalYear=
export async function GET(req: NextRequest) {
  const entityId = req.nextUrl.searchParams.get('entityId')
  const fiscalYear = parseInt(req.nextUrl.searchParams.get('fiscalYear') ?? String(new Date().getFullYear()))
  if (!entityId) return NextResponse.json({ error: 'entityId required' }, { status: 400 })

  const auth = await requireEntityAccess(req, entityId, 'budget:read')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const budget = await db.budget.findFirst({
    where: { entityId, fiscalYear, isActive: true },
    include: {
      lines: {
        include: { account: { select: { id: true, code: true, name: true, type: true } } },
        orderBy: [{ month: 'asc' }],
      },
    },
  })

  // Get actuals from posted journal entries
  const startDate = new Date(`${fiscalYear}-01-01`)
  const endDate   = new Date(`${fiscalYear}-12-31`)

  const actuals = await db.journalLine.groupBy({
    by: ['accountId'],
    where: {
      entry: { entityId, status: 'POSTED', date: { gte: startDate, lte: endDate } },
    },
    _sum: { debit: true, credit: true },
  })

  // Build actuals map keyed by accountId
  const actualsMap: Record<string, { debit: number; credit: number }> = {}
  for (const a of actuals) {
    actualsMap[a.accountId] = {
      debit:  Number(a._sum.debit  ?? 0),
      credit: Number(a._sum.credit ?? 0),
    }
  }

  // Get all accounts for this entity
  const accounts = await db.account.findMany({
    where: { entityId, isActive: true },
    orderBy: [{ type: 'asc' }, { code: 'asc' }],
  })

  // Build monthly budget by account
  const budgetByAccount: Record<string, number[]> = {}
  if (budget) {
    for (const line of budget.lines) {
      if (!budgetByAccount[line.accountId]) {
        budgetByAccount[line.accountId] = Array(12).fill(0)
      }
      budgetByAccount[line.accountId][line.month - 1] = Number(line.amount)
    }
  }

  const report = accounts.map(acct => {
    const budgetMonths  = budgetByAccount[acct.id] ?? Array(12).fill(0)
    const budgetTotal   = budgetMonths.reduce((s, v) => s + v, 0)
    const actual        = actualsMap[acct.id]
    const actualAmount  = actual
      ? (['REVENUE', 'LIABILITY', 'EQUITY'].includes(acct.type)
          ? Number(actual.credit) - Number(actual.debit)
          : Number(actual.debit)  - Number(actual.credit))
      : 0
    const variance      = actualAmount - budgetTotal
    const pctUsed       = budgetTotal !== 0 ? (actualAmount / budgetTotal) * 100 : null

    return {
      account:      { id: acct.id, code: acct.code, name: acct.name, type: acct.type, subType: acct.subType },
      budgetMonths,
      budgetTotal,
      actualAmount,
      variance,
      pctUsed,
      status: pctUsed === null ? 'NO_BUDGET'
            : pctUsed > 110  ? 'OVER'
            : pctUsed > 90   ? 'ON_TRACK'
            : 'UNDER',
    }
  })

  // MIS summary by type
  const mis = {
    revenue:   report.filter(r => r.account.type === 'REVENUE'),
    cogs:      report.filter(r => r.account.type === 'COGS'),
    expenses:  report.filter(r => r.account.type === 'EXPENSE'),
    totalRevenueBudget: report.filter(r => r.account.type === 'REVENUE').reduce((s, r) => s + r.budgetTotal, 0),
    totalRevenueActual: report.filter(r => r.account.type === 'REVENUE').reduce((s, r) => s + r.actualAmount, 0),
    totalExpenseBudget: report.filter(r => ['EXPENSE','COGS'].includes(r.account.type)).reduce((s, r) => s + r.budgetTotal, 0),
    totalExpenseActual: report.filter(r => ['EXPENSE','COGS'].includes(r.account.type)).reduce((s, r) => s + r.actualAmount, 0),
  }

  return NextResponse.json({ budget, report, mis, fiscalYear, actualsMap })
}

// POST /api/budget — create or update budget
export async function POST(req: NextRequest) {
  const body = await req.json()
  const { entityId, fiscalYear, name, lines } = body
  if (!entityId) return NextResponse.json({ error: 'entityId required' }, { status: 400 })

  const auth = await requireEntityAccess(req, entityId, 'budget:write')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const budget = await db.$transaction(async (tx) => {
    const b = await tx.budget.upsert({
      where: { entityId_fiscalYear_name: { entityId, fiscalYear, name: name ?? `FY${fiscalYear}` } },
      create: { entityId, fiscalYear, name: name ?? `FY${fiscalYear}` },
      update: { isActive: true },
    })

    // Delete existing lines and recreate
    await tx.budgetLine.deleteMany({ where: { budgetId: b.id } })

    if (lines && Array.isArray(lines)) {
      await tx.budgetLine.createMany({
        data: lines.map((l: { accountId: string; month: number; amount: number }) => ({
          budgetId: b.id,
          accountId: l.accountId,
          month: l.month,
          amount: l.amount,
        })),
      })
    }
    return b
  })

  return NextResponse.json(budget, { status: 201 })
}

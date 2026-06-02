import { db } from '../db'

/**
 * Dashboard KPI engine.
 *
 * Returns a snapshot of the entity's financial position + this-month / YTD
 * P&L + a 6-month revenue/expense trend. Built to be a single round-trip
 * for the dashboard page.
 *
 * Notes:
 * - All amounts are computed from POSTED journal entries only.
 * - Sign convention: revenue is shown positive (natural credit-balance),
 *   expense is shown positive (natural debit-balance).
 * - Top 5 expenses uses current month period spend.
 */

export interface DashboardKpis {
  cashBalance: number
  cashAccountCount: number
  thisMonth: PeriodSummary
  ytd: PeriodSummary
  apOpen: number
  apOverdue: number
  apOverdueCount: number
  topExpenses: TopExpense[]
  trend: TrendPoint[]
  asOf: string
}

interface PeriodSummary {
  revenue: number
  expense: number
  cogs: number
  netIncome: number
  from: string
  to: string
}

interface TopExpense {
  accountId: string
  code: string
  name: string
  amount: number
}

interface TrendPoint {
  month: string                     // "2026-04"
  label: string                     // "Apr"
  revenue: number
  expense: number
  netIncome: number
}

function monthStart(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}
function monthEnd(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999)
}
function yearStart(d: Date): Date {
  return new Date(d.getFullYear(), 0, 1)
}

async function activityForRange(
  entityId: string,
  from: Date,
  to: Date,
  types: string[],
): Promise<number> {
  // For revenue-natured types (REVENUE) return credit-debit (positive = revenue earned).
  // For expense-natured types (EXPENSE, COGS) return debit-credit (positive = spent).
  const isCreditNatural = types.length === 1 && types[0] === 'REVENUE'
  const lines = await db.journalLine.findMany({
    where: {
      entry: { entityId, status: 'POSTED', date: { gte: from, lte: to } },
      account: { type: { in: types as never[] } },
    },
    select: { debit: true, credit: true },
  })
  let total = 0
  for (const l of lines) {
    const d = Number(l.debit), c = Number(l.credit)
    total += isCreditNatural ? c - d : d - c
  }
  return total
}

async function summary(entityId: string, from: Date, to: Date): Promise<PeriodSummary> {
  const [revenue, expense, cogs] = await Promise.all([
    activityForRange(entityId, from, to, ['REVENUE']),
    activityForRange(entityId, from, to, ['EXPENSE']),
    activityForRange(entityId, from, to, ['COGS']),
  ])
  return {
    revenue,
    expense,
    cogs,
    netIncome: revenue - expense - cogs,
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  }
}

export async function computeDashboard(entityId: string): Promise<DashboardKpis> {
  const now = new Date()
  const monthFrom = monthStart(now), monthTo = monthEnd(now)
  const ytdFrom = yearStart(now), ytdTo = monthTo

  // Cash on hand — sum of (debit − credit) across all journal lines on accounts
  // flagged isBankAccount. Bank accounts are ASSET-natural so debit-credit
  // gives the positive on-hand amount.
  const bankAccounts = await db.account.findMany({
    where: { entityId, isActive: true, isBankAccount: true },
    select: { id: true },
  })
  const cashAccountCount = bankAccounts.length
  let cashBalance = 0
  if (bankAccounts.length > 0) {
    const ids = bankAccounts.map(a => a.id)
    const lines = await db.journalLine.findMany({
      where: {
        accountId: { in: ids },
        entry: { entityId, status: 'POSTED' },
      },
      select: { debit: true, credit: true },
    })
    for (const l of lines) cashBalance += Number(l.debit) - Number(l.credit)
  }

  // This-month and YTD summaries
  const [thisMonth, ytd] = await Promise.all([
    summary(entityId, monthFrom, monthTo),
    summary(entityId, ytdFrom, ytdTo),
  ])

  // AP — open balance + overdue. AP open balance is amount - amountPaid.
  const apInvoices = await db.apInvoice.findMany({
    where: { entityId, status: { not: 'VOID' } },
    select: { amount: true, amountPaid: true, dueDate: true, status: true },
  })
  let apOpen = 0, apOverdue = 0, apOverdueCount = 0
  for (const inv of apInvoices) {
    const bal = Number(inv.amount) - Number(inv.amountPaid)
    if (bal <= 0) continue
    apOpen += bal
    if (inv.dueDate < now) { apOverdue += bal; apOverdueCount++ }
  }

  // Top 5 expense accounts this month
  const expenseLines = await db.journalLine.findMany({
    where: {
      entry: { entityId, status: 'POSTED', date: { gte: monthFrom, lte: monthTo } },
      account: { type: { in: ['EXPENSE', 'COGS'] as never[] } },
    },
    select: {
      accountId: true, debit: true, credit: true,
      account: { select: { code: true, name: true } },
    },
  })
  const byAccount = new Map<string, TopExpense>()
  for (const l of expenseLines) {
    const amt = Number(l.debit) - Number(l.credit)
    if (amt <= 0) continue
    const existing = byAccount.get(l.accountId)
    if (existing) existing.amount += amt
    else byAccount.set(l.accountId, {
      accountId: l.accountId, code: l.account.code, name: l.account.name, amount: amt,
    })
  }
  const topExpenses = [...byAccount.values()].sort((a, b) => b.amount - a.amount).slice(0, 5)

  // 6-month trend (this month + 5 prior, oldest first for left-to-right chart)
  const trend: TrendPoint[] = []
  for (let i = 5; i >= 0; i--) {
    const ref = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const from = monthStart(ref), to = monthEnd(ref)
    const s = await summary(entityId, from, to)
    trend.push({
      month: `${ref.getFullYear()}-${String(ref.getMonth() + 1).padStart(2, '0')}`,
      label: ref.toLocaleString('en-US', { month: 'short' }),
      revenue: s.revenue,
      expense: s.expense + s.cogs,
      netIncome: s.netIncome,
    })
  }

  return {
    cashBalance, cashAccountCount,
    thisMonth, ytd,
    apOpen, apOverdue, apOverdueCount,
    topExpenses, trend,
    asOf: now.toISOString(),
  }
}

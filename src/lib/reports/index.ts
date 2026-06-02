import { db } from '../db'
import { AccountType } from '@prisma/client'

/**
 * Financial Reporting Engine
 * ---------------------------------------------------------------------------
 * Derives all reports from POSTED journal entries only, so drafts and voids
 * never affect the books. All money math is done with integer cents to avoid
 * floating-point drift, then converted back to numbers on the way out.
 */

// ─── Money helpers (integer-cent math) ─────────────────────────────────────────
const toCents = (n: unknown) => Math.round(Number(n ?? 0) * 100)
const fromCents = (c: number) => c / 100

// Account types where a DEBIT increases the natural balance.
const DEBIT_NORMAL: AccountType[] = ['ASSET', 'EXPENSE', 'COGS']
const isDebitNormal = (t: AccountType) => DEBIT_NORMAL.includes(t)

export interface DateRange {
  from?: Date
  to?: Date
}

interface AccountBalance {
  accountId: string
  code: string
  name: string
  type: AccountType
  subType: string | null
  debit: number   // total debits in range
  credit: number  // total credits in range
  balance: number // signed natural balance (debit-normal positive)
}

// ─── Core: aggregate posted journal lines into per-account balances ────────────
async function getAccountBalances(
  entityId: string,
  range: DateRange = {}
): Promise<AccountBalance[]> {
  const dateFilter: Record<string, Date> = {}
  if (range.from) dateFilter.gte = range.from
  if (range.to) dateFilter.lte = range.to

  const accounts = await db.account.findMany({
    where: { entityId },
    select: { id: true, code: true, name: true, type: true, subType: true },
    orderBy: [{ type: 'asc' }, { code: 'asc' }],
  })

  const lines = await db.journalLine.findMany({
    where: {
      entry: {
        entityId,
        status: 'POSTED',
        ...(range.from || range.to ? { date: dateFilter } : {}),
      },
    },
    select: { accountId: true, debit: true, credit: true },
  })

  const agg = new Map<string, { debit: number; credit: number }>()
  for (const l of lines) {
    const cur = agg.get(l.accountId) ?? { debit: 0, credit: 0 }
    cur.debit += toCents(l.debit)
    cur.credit += toCents(l.credit)
    agg.set(l.accountId, cur)
  }

  return accounts.map((a) => {
    const { debit = 0, credit = 0 } = agg.get(a.id) ?? {}
    const signed = isDebitNormal(a.type) ? debit - credit : credit - debit
    return {
      accountId: a.id,
      code: a.code,
      name: a.name,
      type: a.type,
      subType: a.subType,
      debit: fromCents(debit),
      credit: fromCents(credit),
      balance: fromCents(signed),
    }
  })
}

// ─── Trial Balance ─────────────────────────────────────────────────────────────
export async function trialBalance(entityId: string, range: DateRange = {}) {
  const balances = await getAccountBalances(entityId, range)
  const rows = balances
    .filter((b) => b.debit !== 0 || b.credit !== 0)
    .map((b) => {
      // Present each account on its natural side.
      const net = b.balance
      const debit = net >= 0 ? (isDebitNormal(b.type) ? net : 0) : (isDebitNormal(b.type) ? 0 : -net)
      const credit = net >= 0 ? (isDebitNormal(b.type) ? 0 : net) : (isDebitNormal(b.type) ? -net : 0)
      return { code: b.code, name: b.name, type: b.type, debit, credit }
    })

  const totalDebit = rows.reduce((s, r) => s + r.debit, 0)
  const totalCredit = rows.reduce((s, r) => s + r.credit, 0)

  return {
    rows,
    totalDebit,
    totalCredit,
    balanced: Math.abs(totalDebit - totalCredit) < 0.005,
    range,
  }
}

// ─── Profit & Loss (Income Statement) ──────────────────────────────────────────
export async function profitAndLoss(entityId: string, range: DateRange = {}) {
  const balances = await getAccountBalances(entityId, range)

  const pick = (t: AccountType) =>
    balances
      .filter((b) => b.type === t && b.balance !== 0)
      .map((b) => ({ code: b.code, name: b.name, amount: Math.abs(b.balance) }))

  const revenue = pick('REVENUE')
  const cogs = pick('COGS')
  const expenses = pick('EXPENSE')

  const sum = (rows: { amount: number }[]) => rows.reduce((s, r) => s + r.amount, 0)
  const totalRevenue = sum(revenue)
  const totalCogs = sum(cogs)
  const totalExpenses = sum(expenses)
  const grossProfit = totalRevenue - totalCogs
  const netIncome = grossProfit - totalExpenses

  return {
    revenue,
    cogs,
    expenses,
    totalRevenue,
    totalCogs,
    grossProfit,
    grossMargin: totalRevenue ? grossProfit / totalRevenue : 0,
    totalExpenses,
    netIncome,
    netMargin: totalRevenue ? netIncome / totalRevenue : 0,
    range,
  }
}

// ─── Balance Sheet ──────────────────────────────────────────────────────────────
// "as of" => from beginning of time through `asOf`. Net income for the period
// rolls into Retained Earnings so the sheet balances.
export async function balanceSheet(entityId: string, asOf?: Date) {
  const balances = await getAccountBalances(entityId, { to: asOf })

  const pick = (t: AccountType) =>
    balances
      .filter((b) => b.type === t && b.balance !== 0)
      .map((b) => ({ code: b.code, name: b.name, amount: b.balance }))

  const assets = pick('ASSET')
  const liabilities = pick('LIABILITY')
  const equity = pick('EQUITY')

  const sum = (rows: { amount: number }[]) => rows.reduce((s, r) => s + r.amount, 0)

  // Net income to date = Revenue - COGS - Expenses (closes into equity).
  const revenue = balances.filter((b) => b.type === 'REVENUE').reduce((s, b) => s + b.balance, 0)
  const cogs = balances.filter((b) => b.type === 'COGS').reduce((s, b) => s + b.balance, 0)
  const expenses = balances.filter((b) => b.type === 'EXPENSE').reduce((s, b) => s + b.balance, 0)
  const netIncome = revenue - cogs - expenses

  const totalAssets = sum(assets)
  const totalLiabilities = sum(liabilities)
  const totalEquityBooked = sum(equity)
  const totalEquity = totalEquityBooked + netIncome

  const equityRows = [...equity]
  if (Math.abs(netIncome) > 0.005) {
    equityRows.push({ code: '3900', name: 'Current Year Earnings', amount: netIncome })
  }

  return {
    assets,
    liabilities,
    equity: equityRows,
    totalAssets,
    totalLiabilities,
    totalEquity,
    totalLiabilitiesAndEquity: totalLiabilities + totalEquity,
    balanced: Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 0.005,
    asOf: asOf ?? null,
  }
}

// ─── General Ledger (per account, with running balance) ────────────────────────
export async function generalLedger(
  entityId: string,
  opts: { accountId?: string } & DateRange = {}
) {
  const dateFilter: Record<string, Date> = {}
  if (opts.from) dateFilter.gte = opts.from
  if (opts.to) dateFilter.lte = opts.to

  const accounts = await db.account.findMany({
    where: { entityId, ...(opts.accountId ? { id: opts.accountId } : {}) },
    select: { id: true, code: true, name: true, type: true },
    orderBy: [{ type: 'asc' }, { code: 'asc' }],
  })

  const result = []
  for (const acct of accounts) {
    // Opening balance = activity strictly before `from`.
    let openingCents = 0
    if (opts.from) {
      const prior = await db.journalLine.findMany({
        where: {
          accountId: acct.id,
          entry: { entityId, status: 'POSTED', date: { lt: opts.from } },
        },
        select: { debit: true, credit: true },
      })
      for (const l of prior) {
        const d = toCents(l.debit) - toCents(l.credit)
        openingCents += isDebitNormal(acct.type) ? d : -d
      }
    }

    const lines = await db.journalLine.findMany({
      where: {
        accountId: acct.id,
        entry: {
          entityId,
          status: 'POSTED',
          ...(opts.from || opts.to ? { date: dateFilter } : {}),
        },
      },
      select: {
        debit: true,
        credit: true,
        description: true,
        entry: { select: { ref: true, date: true, description: true } },
      },
      orderBy: { entry: { date: 'asc' } },
    })

    if (lines.length === 0 && openingCents === 0) continue

    let runningCents = openingCents
    const entries = lines.map((l) => {
      const d = toCents(l.debit) - toCents(l.credit)
      runningCents += isDebitNormal(acct.type) ? d : -d
      return {
        date: l.entry.date,
        ref: l.entry.ref,
        description: l.description || l.entry.description,
        debit: fromCents(toCents(l.debit)),
        credit: fromCents(toCents(l.credit)),
        balance: fromCents(runningCents),
      }
    })

    result.push({
      account: { code: acct.code, name: acct.name, type: acct.type },
      opening: fromCents(openingCents),
      closing: fromCents(runningCents),
      entries,
    })
  }

  return { accounts: result, range: { from: opts.from, to: opts.to } }
}

// ─── AR / AP Aging ──────────────────────────────────────────────────────────────
// AP comes from ApInvoice. (AR would mirror this once invoicing exists.)
export async function apAging(entityId: string, asOf: Date = new Date()) {
  const invoices = await db.apInvoice.findMany({
    where: { entityId, status: { notIn: ['PAID', 'VOID'] } },
    select: {
      vendor: true,
      invoiceNo: true,
      dueDate: true,
      amount: true,
      amountPaid: true,
    },
    orderBy: { dueDate: 'asc' },
  })

  const buckets = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0 }
  const rows = invoices.map((inv) => {
    const balance = fromCents(toCents(inv.amount) - toCents(inv.amountPaid))
    const daysOverdue = Math.floor((asOf.getTime() - new Date(inv.dueDate).getTime()) / 86400000)
    let bucket: keyof typeof buckets = 'current'
    if (daysOverdue > 90) bucket = 'd90plus'
    else if (daysOverdue > 60) bucket = 'd61_90'
    else if (daysOverdue > 30) bucket = 'd31_60'
    else if (daysOverdue > 0) bucket = 'd1_30'
    buckets[bucket] += balance
    return {
      vendor: inv.vendor,
      invoiceNo: inv.invoiceNo,
      dueDate: inv.dueDate,
      daysOverdue: Math.max(0, daysOverdue),
      balance,
      bucket,
    }
  })

  return {
    rows,
    buckets,
    total: Object.values(buckets).reduce((s, v) => s + v, 0),
    asOf,
  }
}

// ─── Statement of Cash Flows (indirect method) ─────────────────────────────────
// Reconstructs cash movement by category from the journal:
//   Operating  = net income + changes in working capital (AR, AP, inventory, etc.)
//   Investing  = changes in long-term assets (PPE, investments)
//   Financing  = changes in equity and long-term debt
//
// Since LedgerPro doesn't yet classify accounts as current/long-term, we use
// a pragmatic mapping:
//   - REVENUE, EXPENSE, COGS                    → operating (via net income)
//   - ASSET except bank/cash                    → operating working-capital change
//   - LIABILITY except long-term-debt subtype   → operating working-capital change
//   - bank/cash accounts themselves             → the running total we're explaining
//   - EQUITY                                    → financing
//
// This is the "indirect method" view QuickBooks shows by default. It always
// reconciles to actual cash change in the bank account(s) because every
// posted entry hits some side of the equation.
export async function cashFlows(entityId: string, range: DateRange = {}) {
  const balances = await getAccountBalances(entityId, range)

  // Net income for the period drives the top of the operating section.
  const revenue = balances.filter((b) => b.type === 'REVENUE').reduce((s, b) => s + b.balance, 0)
  const cogs = balances.filter((b) => b.type === 'COGS').reduce((s, b) => s + b.balance, 0)
  const expenses = balances.filter((b) => b.type === 'EXPENSE').reduce((s, b) => s + b.balance, 0)
  const netIncome = revenue - cogs - expenses

  // For working-capital changes: each non-cash asset increase REDUCES cash;
  // each liability increase INCREASES cash.
  const nonCashAssets = balances.filter((b) => b.type === 'ASSET' && b.balance !== 0 && !isCashLike(b.code, b.subType))
  const operatingLiabs = balances.filter((b) => b.type === 'LIABILITY' && b.balance !== 0 && !isLongTermDebt(b.subType))

  const operatingChanges = [
    ...nonCashAssets.map((a) => ({
      code: a.code, name: a.name, amount: -a.balance,   // asset up → cash down
      direction: a.balance >= 0 ? 'decrease' : 'increase',
    })),
    ...operatingLiabs.map((a) => ({
      code: a.code, name: a.name, amount: a.balance,    // liability up → cash up
      direction: a.balance >= 0 ? 'increase' : 'decrease',
    })),
  ]

  const operatingCashFlow = netIncome + operatingChanges.reduce((s, r) => s + r.amount, 0)

  // Investing: long-term asset purchases (none classified yet — placeholder).
  const investingCashFlow = 0
  const investingItems: typeof operatingChanges = []

  // Financing: equity contributions/draws + long-term debt changes.
  const equity = balances.filter((b) => b.type === 'EQUITY' && b.balance !== 0)
  const ltDebt = balances.filter((b) => b.type === 'LIABILITY' && isLongTermDebt(b.subType) && b.balance !== 0)
  const financingItems = [
    ...equity.map((a) => ({ code: a.code, name: a.name, amount: a.balance })),
    ...ltDebt.map((a) => ({ code: a.code, name: a.name, amount: a.balance })),
  ]
  const financingCashFlow = financingItems.reduce((s, r) => s + r.amount, 0)

  // Cash at start and end (sum of bank-account balances).
  const bankAccounts = balances.filter((b) => isCashLike(b.code, b.subType))
  const cashAtEnd = bankAccounts.reduce((s, b) => s + b.balance, 0)
  // Cash at start = opening balance prior to `range.from`.
  let cashAtStart = 0
  if (range.from) {
    const opening = await getAccountBalances(entityId, { to: new Date(range.from.getTime() - 1) })
    cashAtStart = opening
      .filter((b) => isCashLike(b.code, b.subType))
      .reduce((s, b) => s + b.balance, 0)
  }

  return {
    operating: {
      netIncome,
      adjustments: operatingChanges,
      total: operatingCashFlow,
    },
    investing: { items: investingItems, total: investingCashFlow },
    financing: { items: financingItems, total: financingCashFlow },
    netCashChange: operatingCashFlow + investingCashFlow + financingCashFlow,
    cashAtStart,
    cashAtEnd,
    range,
  }
}

// Heuristics for account classification — pragmatic until we add explicit flags.
function isCashLike(code: string, subType: string | null): boolean {
  const c = (code || '').toString()
  const s = (subType || '').toLowerCase()
  return /^10[0-2]\d/.test(c) || s.includes('bank') || s.includes('cash')
}
function isLongTermDebt(subType: string | null): boolean {
  const s = (subType || '').toLowerCase()
  return s.includes('long-term') || s.includes('loan') || s.includes('mortgage') || s.includes('note payable')
}

// ─── Journal Report ────────────────────────────────────────────────────────────
// Every journal entry in the period with all lines, ordered chronologically.
// Mirrors QuickBooks' "Journal" report — the auditor's go-to.
export async function journalReport(entityId: string, range: DateRange = {}) {
  const dateFilter: Record<string, Date> = {}
  if (range.from) dateFilter.gte = range.from
  if (range.to) dateFilter.lte = range.to

  const entries = await db.journalEntry.findMany({
    where: {
      entityId,
      status: 'POSTED',
      ...(range.from || range.to ? { date: dateFilter } : {}),
    },
    include: {
      lines: {
        include: { account: { select: { code: true, name: true } } },
        orderBy: { lineOrder: 'asc' },
      },
    },
    orderBy: [{ date: 'asc' }, { ref: 'asc' }],
  })

  const rows = entries.map((e) => ({
    date: e.date,
    ref: e.ref,
    description: e.description,
    source: e.source,
    lines: e.lines.map((l) => ({
      accountCode: l.account.code,
      accountName: l.account.name,
      description: l.description,
      debit: Number(l.debit),
      credit: Number(l.credit),
    })),
    totalDebit: e.lines.reduce((s, l) => s + Number(l.debit), 0),
    totalCredit: e.lines.reduce((s, l) => s + Number(l.credit), 0),
  }))

  return {
    entries: rows,
    totalEntries: rows.length,
    totalDebit: rows.reduce((s, r) => s + r.totalDebit, 0),
    totalCredit: rows.reduce((s, r) => s + r.totalCredit, 0),
    range,
  }
}

// ─── A/P Aging Detail ─────────────────────────────────────────────────────────
// Same buckets as the summary, but lists every unpaid invoice with its current
// balance — what QB shows on "A/P Aging Detail."
export async function apAgingDetail(entityId: string, asOf: Date = new Date()) {
  const invoices = await db.apInvoice.findMany({
    where: { entityId, status: { notIn: ['PAID', 'VOID'] } },
    select: {
      id: true,
      vendor: true,
      invoiceNo: true,
      invoiceDate: true,
      dueDate: true,
      amount: true,
      amountPaid: true,
      status: true,
    },
    orderBy: [{ vendor: 'asc' }, { dueDate: 'asc' }],
  })

  const rows = invoices.map((inv) => {
    const balance = fromCents(toCents(inv.amount) - toCents(inv.amountPaid))
    const daysOverdue = Math.floor((asOf.getTime() - new Date(inv.dueDate).getTime()) / 86400000)
    let bucket: 'current' | 'd1_30' | 'd31_60' | 'd61_90' | 'd90plus' = 'current'
    if (daysOverdue > 90) bucket = 'd90plus'
    else if (daysOverdue > 60) bucket = 'd61_90'
    else if (daysOverdue > 30) bucket = 'd31_60'
    else if (daysOverdue > 0) bucket = 'd1_30'
    return {
      vendor: inv.vendor,
      invoiceNo: inv.invoiceNo,
      invoiceDate: inv.invoiceDate,
      dueDate: inv.dueDate,
      daysOverdue: Math.max(0, daysOverdue),
      amount: Number(inv.amount),
      amountPaid: Number(inv.amountPaid),
      balance,
      bucket,
      status: inv.status,
    }
  })

  // Group by vendor for the QB-style nested layout.
  const byVendor = new Map<string, typeof rows>()
  for (const r of rows) {
    if (!byVendor.has(r.vendor)) byVendor.set(r.vendor, [])
    byVendor.get(r.vendor)!.push(r)
  }
  const vendors = Array.from(byVendor.entries()).map(([vendor, invoices]) => ({
    vendor,
    invoices,
    total: invoices.reduce((s, i) => s + i.balance, 0),
  }))

  return {
    vendors,
    grandTotal: rows.reduce((s, r) => s + r.balance, 0),
    asOf,
  }
}

// ─── Expenses by Vendor ───────────────────────────────────────────────────────
// Aggregates AP invoice amounts by vendor over the period. QuickBooks calls
// this "Expenses by Vendor Summary."
export async function expensesByVendor(entityId: string, range: DateRange = {}) {
  const dateFilter: Record<string, Date> = {}
  if (range.from) dateFilter.gte = range.from
  if (range.to) dateFilter.lte = range.to

  const invoices = await db.apInvoice.findMany({
    where: {
      entityId,
      status: { not: 'VOID' },
      ...(range.from || range.to ? { invoiceDate: dateFilter } : {}),
    },
    select: { vendor: true, amount: true, invoiceDate: true, status: true },
  })

  const agg = new Map<string, { totalCents: number; count: number }>()
  for (const inv of invoices) {
    const cur = agg.get(inv.vendor) ?? { totalCents: 0, count: 0 }
    cur.totalCents += toCents(inv.amount)
    cur.count += 1
    agg.set(inv.vendor, cur)
  }

  const rows = Array.from(agg.entries())
    .map(([vendor, v]) => ({
      vendor,
      totalAmount: fromCents(v.totalCents),
      invoiceCount: v.count,
    }))
    .sort((a, b) => b.totalAmount - a.totalAmount)

  return {
    rows,
    grandTotal: rows.reduce((s, r) => s + r.totalAmount, 0),
    totalInvoices: rows.reduce((s, r) => s + r.invoiceCount, 0),
    range,
  }
}

// ─── Profit & Loss with comparison period ─────────────────────────────────────
// Convenience wrapper that returns P&L for the requested range and an
// equivalent prior period, for side-by-side comparison columns.
export async function profitAndLossComparison(entityId: string, range: DateRange) {
  if (!range.from || !range.to) {
    throw new Error('Comparison report requires both from and to dates')
  }
  const current = await profitAndLoss(entityId, range)

  // Prior period: same length immediately before `from`.
  const lengthMs = range.to.getTime() - range.from.getTime()
  const priorTo = new Date(range.from.getTime() - 1)
  const priorFrom = new Date(priorTo.getTime() - lengthMs)
  const prior = await profitAndLoss(entityId, { from: priorFrom, to: priorTo })

  // Same-period last year, for the "vs prior year" column.
  const yearFrom = new Date(range.from); yearFrom.setFullYear(yearFrom.getFullYear() - 1)
  const yearTo = new Date(range.to);     yearTo.setFullYear(yearTo.getFullYear() - 1)
  const priorYear = await profitAndLoss(entityId, { from: yearFrom, to: yearTo })

  return {
    current,
    prior,
    priorYear,
    range,
    priorRange: { from: priorFrom, to: priorTo },
    priorYearRange: { from: yearFrom, to: yearTo },
  }
}

// ─── MIS / Department reports ─────────────────────────────────────────────────
//
// These reports produce a cross-tab where columns are MIS codes (departments)
// and rows are accounts. Lines without an MIS code are summed into a special
// "(Unallocated)" column so totals always tie back to the standard reports.
//
// Both reports respect the standard date range / POSTED-only / entity filters.

interface MisColumn {
  id: string                   // MIS code id, or "_unallocated"
  code: string                 // human-readable column header
  department: string
}

interface MisAccountRow {
  accountId: string
  code: string
  name: string
  type: string
  byColumn: Record<string, number>     // { [columnId]: netAmount }
  total: number
}

interface MisCubeResult {
  columns: MisColumn[]
  rows: MisAccountRow[]
  totals: Record<string, number>
}

/**
 * Internal: builds an account × MIS-code cube for the given account-type set
 * and date range. Used by profitAndLossByDepartment and trialBalanceByDepartment.
 */
async function buildMisCube(
  entityId: string,
  range: DateRange,
  accountTypes: string[],
  natural: 'CREDIT' | 'DEBIT',          // determines sign convention for "amount" column
): Promise<MisCubeResult> {
  // Active MIS codes form the columns; we also always add an "Unallocated" column.
  const codes = await db.misCode.findMany({
    where: { entityId, isActive: true },
    orderBy: [{ displayOrder: 'asc' }, { code: 'asc' }],
    select: { id: true, code: true, department: true },
  })
  const columns: MisColumn[] = [
    ...codes.map(c => ({ id: c.id, code: c.code, department: c.department })),
    { id: '_unallocated', code: '(Unallocated)', department: 'No MIS code' },
  ]

  const where: Parameters<typeof db.journalLine.findMany>[0] = {
    where: {
      entry: {
        entityId,
        status: 'POSTED',
        ...(range.from || range.to ? {
          date: {
            ...(range.from ? { gte: range.from } : {}),
            ...(range.to   ? { lte: range.to   } : {}),
          },
        } : {}),
      },
      account: { type: { in: accountTypes as never[] } },
    },
    include: {
      account: { select: { id: true, code: true, name: true, type: true } },
    },
  } as Parameters<typeof db.journalLine.findMany>[0]
  const lines = await db.journalLine.findMany(where)

  // Aggregate by (accountId, columnKey)
  const rowsMap = new Map<string, MisAccountRow>()
  const totals: Record<string, number> = Object.fromEntries(columns.map(c => [c.id, 0]))

  for (const line of lines as Array<{
    accountId: string; debit: unknown; credit: unknown; misCodeId: string | null;
    account: { id: string; code: string; name: string; type: string }
  }>) {
    const sign = natural === 'CREDIT' ? -1 : 1
    const net = sign * (Number(line.debit) - Number(line.credit))
    const colId = line.misCodeId && columns.find(c => c.id === line.misCodeId) ? line.misCodeId : '_unallocated'
    const accountId = line.account.id

    let row = rowsMap.get(accountId)
    if (!row) {
      row = {
        accountId,
        code: line.account.code,
        name: line.account.name,
        type: line.account.type,
        byColumn: Object.fromEntries(columns.map(c => [c.id, 0])),
        total: 0,
      }
      rowsMap.set(accountId, row)
    }
    row.byColumn[colId] += net
    row.total += net
    totals[colId] += net
  }

  // Sort rows by account code for consistent reading order.
  const rows = [...rowsMap.values()].sort((a, b) => a.code.localeCompare(b.code))
  return { columns, rows, totals }
}

/**
 * P&L by Department — revenue and expense accounts as rows, MIS codes as columns.
 * Revenue rows use natural credit-balance convention (so positives are revenue),
 * expense/COGS rows use natural debit-balance.
 */
export async function profitAndLossByDepartment(entityId: string, range: DateRange = {}) {
  const revenue = await buildMisCube(entityId, range, ['REVENUE'], 'CREDIT')
  const expense = await buildMisCube(entityId, range, ['EXPENSE', 'COGS'], 'DEBIT')

  // Net income = revenue total − expense total, per column.
  const columns = revenue.columns  // same column set for both
  const netByCol: Record<string, number> = {}
  for (const c of columns) {
    netByCol[c.id] = (revenue.totals[c.id] ?? 0) - (expense.totals[c.id] ?? 0)
  }
  return {
    columns,
    revenue,
    expense,
    netIncome: netByCol,
    range,
  }
}

/**
 * Trial Balance by Department — every account as a row, MIS codes as columns.
 * Uses raw debit-credit signed net (positive = debit, negative = credit) for
 * easy verification that columns balance.
 */
export async function trialBalanceByDepartment(entityId: string, range: DateRange = {}) {
  const cube = await buildMisCube(
    entityId, range,
    ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE', 'COGS'],
    'DEBIT',
  )
  return { ...cube, range }
}

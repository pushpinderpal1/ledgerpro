import { db } from '../db'
import type { Prisma, PrismaClient } from '@prisma/client'

/**
 * Bank Reconciliation engine.
 *
 * Two paths, both supported:
 *  1. Statement upload  — parse CSV/OFX, persist StatementLines, auto-match
 *     them against uncleared journal lines on the bank account.
 *  2. Manual recon      — user ticks (clears) journal lines and sets a
 *     clearing date per line; running cleared balance is compared to the
 *     statement ending balance.
 *
 * A reconciliation is balanced when:
 *   beginningBalance + sum(cleared line movements) === endingBalance
 * On finalize, cleared lines are locked to RECONCILED.
 *
 * Integer-cent math throughout.
 */

const toCents = (n: unknown) => Math.round(Number(n ?? 0) * 100)
const fromCents = (c: number) => c / 100
type Tx = Prisma.TransactionClient | PrismaClient

// On a bank account (ASSET, debit-normal), a debit increases cash, credit decreases.
const lineMovementCents = (debit: unknown, credit: unknown) => toCents(debit) - toCents(credit)

// ─── Statement parsing ─────────────────────────────────────────────────────────

export interface ParsedStatementLine {
  date: Date
  description: string
  amount: number // signed: + deposit, - withdrawal
  reference?: string
}

/**
 * Parse a CSV bank statement. Tolerant of common layouts:
 *  - single signed Amount column, OR separate Debit/Credit (or Withdrawal/Deposit)
 *  - flexible header names; case-insensitive
 */
export function parseCsvStatement(content: string): ParsedStatementLine[] {
  const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0)
  if (lines.length < 2) return []

  const headers = splitCsvRow(lines[0]).map((h) => h.trim().toLowerCase())
  const idx = (...names: string[]) =>
    headers.findIndex((h) => names.some((n) => h.includes(n)))

  const iDate = idx('date', 'posted')
  const iDesc = idx('description', 'memo', 'payee', 'detail', 'narration')
  const iAmount = idx('amount', 'value')
  const iDebit = idx('debit', 'withdrawal', 'paid out', 'money out')
  const iCredit = idx('credit', 'deposit', 'paid in', 'money in')
  const iRef = idx('reference', 'ref', 'check', 'cheque', 'transaction id')

  const out: ParsedStatementLine[] = []
  for (let r = 1; r < lines.length; r++) {
    const cells = splitCsvRow(lines[r])
    if (cells.length === 0) continue

    const rawDate = iDate >= 0 ? cells[iDate] : ''
    const date = parseFlexDate(rawDate)
    if (!date) continue

    let amount = 0
    if (iAmount >= 0 && cells[iAmount]) {
      amount = parseMoney(cells[iAmount])
    } else {
      const debit = iDebit >= 0 ? parseMoney(cells[iDebit]) : 0
      const credit = iCredit >= 0 ? parseMoney(cells[iCredit]) : 0
      amount = credit - debit // deposit positive, withdrawal negative
    }

    out.push({
      date,
      description: (iDesc >= 0 ? cells[iDesc] : '').trim() || 'Statement line',
      amount: fromCents(toCents(amount)),
      reference: iRef >= 0 ? cells[iRef]?.trim() : undefined,
    })
  }
  return out
}

/** Minimal OFX/QFX parser — pulls <STMTTRN> blocks. */
export function parseOfxStatement(content: string): ParsedStatementLine[] {
  const out: ParsedStatementLine[] = []
  const blocks = content.match(/<STMTTRN>[\s\S]*?<\/STMTTRN>/gi) ?? []
  const tag = (b: string, t: string) => {
    const m = b.match(new RegExp(`<${t}>([^<\r\n]*)`, 'i'))
    return m ? m[1].trim() : ''
  }
  for (const b of blocks) {
    const dt = tag(b, 'DTPOSTED')
    const date = parseFlexDate(dt.slice(0, 8))
    if (!date) continue
    const amount = parseMoney(tag(b, 'TRNAMT'))
    const name = tag(b, 'NAME') || tag(b, 'MEMO') || 'Statement line'
    out.push({
      date,
      description: name,
      amount: fromCents(toCents(amount)),
      reference: tag(b, 'FITID') || tag(b, 'CHECKNUM') || undefined,
    })
  }
  return out
}

export function parseStatement(filename: string, content: string): ParsedStatementLine[] {
  const lower = filename.toLowerCase()
  if (lower.endsWith('.ofx') || lower.endsWith('.qfx') || /<STMTTRN>/i.test(content)) {
    return parseOfxStatement(content)
  }
  return parseCsvStatement(content)
}

// ─── Reconciliation lifecycle ──────────────────────────────────────────────────

export async function startReconciliation(input: {
  entityId: string
  bankAccountId: string
  statementDate: string
  beginningBalance: number
  endingBalance: number
  statementFile?: string
  parsedLines?: ParsedStatementLine[]
}) {
  const bank = await db.account.findFirst({
    where: { id: input.bankAccountId, entityId: input.entityId },
  })
  if (!bank) throw new Error('Bank account not found')

  return db.$transaction(async (tx) => {
    const recon = await tx.bankReconciliation.create({
      data: {
        entityId: input.entityId,
        bankAccountId: input.bankAccountId,
        statementDate: new Date(input.statementDate),
        beginningBalance: input.beginningBalance,
        endingBalance: input.endingBalance,
        statementFile: input.statementFile,
        status: 'IN_PROGRESS',
      },
    })

    if (input.parsedLines?.length) {
      await tx.statementLine.createMany({
        data: input.parsedLines.map((l) => ({
          reconciliationId: recon.id,
          date: l.date,
          description: l.description,
          amount: l.amount,
          reference: l.reference,
        })),
      })
      await autoMatch(recon.id, input.entityId, input.bankAccountId, tx)
    }

    return tx.bankReconciliation.findUnique({ where: { id: recon.id } })
  })
}

/**
 * Auto-match statement lines to uncleared journal lines on the bank account by
 * (amount exact) and (date within ±5 days). First match wins.
 */
export async function autoMatch(
  reconciliationId: string,
  entityId: string,
  bankAccountId: string,
  tx: Tx = db
) {
  const stmtLines = await tx.statementLine.findMany({
    where: { reconciliationId, isMatched: false },
  })
  const glLines = await tx.journalLine.findMany({
    where: {
      accountId: bankAccountId,
      clearedStatus: 'UNCLEARED',
      entry: { entityId, status: 'POSTED' },
    },
    include: { entry: { select: { date: true } } },
  })

  const used = new Set<string>()
  let matched = 0

  for (const sl of stmtLines) {
    const target = toCents(sl.amount)
    const slTime = sl.date.getTime()
    const hit = glLines.find((gl) => {
      if (used.has(gl.id)) return false
      const mv = lineMovementCents(gl.debit, gl.credit)
      if (mv !== target) return false
      const days = Math.abs(slTime - gl.entry.date.getTime()) / 86400000
      return days <= 5
    })
    if (hit) {
      used.add(hit.id)
      matched++
      await tx.statementLine.update({
        where: { id: sl.id },
        data: { isMatched: true, matchedLineId: hit.id },
      })
      await tx.journalLine.update({
        where: { id: hit.id },
        data: {
          clearedStatus: 'CLEARED',
          clearedDate: sl.date,
          reconciledId: reconciliationId,
        },
      })
    }
  }
  return { matched, totalStatementLines: stmtLines.length }
}

/**
 * Manual clear / unclear of a single journal line, with an explicit clearing date.
 * This is the "tick the box and set a clearing date" workflow.
 */
export async function setLineCleared(input: {
  entityId: string
  reconciliationId: string
  journalLineId: string
  cleared: boolean
  clearedDate?: string
}) {
  const recon = await db.bankReconciliation.findFirst({
    where: { id: input.reconciliationId, entityId: input.entityId },
  })
  if (!recon) throw new Error('Reconciliation not found')
  if (recon.status === 'COMPLETED') throw new Error('Reconciliation already completed')

  const line = await db.journalLine.findFirst({
    where: { id: input.journalLineId, accountId: recon.bankAccountId },
  })
  if (!line) throw new Error('Journal line not on this bank account')

  return db.journalLine.update({
    where: { id: input.journalLineId },
    data: input.cleared
      ? {
          clearedStatus: 'CLEARED',
          clearedDate: input.clearedDate ? new Date(input.clearedDate) : new Date(),
          reconciledId: input.reconciliationId,
        }
      : { clearedStatus: 'UNCLEARED', clearedDate: null, reconciledId: null },
  })
}

/**
 * Compute live reconciliation status: list of bank lines split into cleared /
 * uncleared, plus the difference between the cleared balance and the statement.
 */
export async function getReconciliationState(reconciliationId: string, entityId: string) {
  const recon = await db.bankReconciliation.findFirst({
    where: { id: reconciliationId, entityId },
  })
  if (!recon) throw new Error('Reconciliation not found')

  // All posted bank lines up to the statement date.
  const lines = await db.journalLine.findMany({
    where: {
      accountId: recon.bankAccountId,
      entry: { entityId, status: 'POSTED', date: { lte: recon.statementDate } },
    },
    include: { entry: { select: { ref: true, date: true, description: true } } },
    orderBy: { entry: { date: 'asc' } },
  })

  const map = (l: (typeof lines)[number]) => ({
    id: l.id,
    date: l.entry.date,
    ref: l.entry.ref,
    description: l.description || l.entry.description,
    debit: fromCents(toCents(l.debit)),
    credit: fromCents(toCents(l.credit)),
    movement: fromCents(lineMovementCents(l.debit, l.credit)),
    clearedStatus: l.clearedStatus,
    clearedDate: l.clearedDate,
    inThisRecon: l.reconciledId === reconciliationId,
  })

  const cleared = lines
    .filter((l) => l.clearedStatus !== 'UNCLEARED' && l.reconciledId === reconciliationId)
    .map(map)
  const uncleared = lines
    .filter((l) => l.clearedStatus === 'UNCLEARED' || l.reconciledId !== reconciliationId)
    .map(map)

  const beginCents = toCents(recon.beginningBalance)
  const endCents = toCents(recon.endingBalance)
  const clearedMovementCents = cleared.reduce((s, l) => s + toCents(l.movement), 0)
  const clearedBalanceCents = beginCents + clearedMovementCents
  const differenceCents = endCents - clearedBalanceCents

  const statementLines = await db.statementLine.findMany({
    where: { reconciliationId },
    orderBy: { date: 'asc' },
  })

  return {
    reconciliation: recon,
    cleared,
    uncleared,
    statementLines,
    summary: {
      beginningBalance: fromCents(beginCents),
      endingBalance: fromCents(endCents),
      clearedBalance: fromCents(clearedBalanceCents),
      clearedCount: cleared.length,
      unclearedCount: uncleared.length,
      difference: fromCents(differenceCents),
      isBalanced: differenceCents === 0,
    },
  }
}

/** Finalize: requires zero difference. Locks cleared lines to RECONCILED. */
export async function finalizeReconciliation(
  reconciliationId: string,
  entityId: string,
  userId?: string
) {
  const state = await getReconciliationState(reconciliationId, entityId)
  if (!state.summary.isBalanced) {
    throw new Error(
      `Cannot finalize: out of balance by ${state.summary.difference.toFixed(2)}`
    )
  }

  return db.$transaction(async (tx) => {
    await tx.journalLine.updateMany({
      where: { reconciledId: reconciliationId, clearedStatus: 'CLEARED' },
      data: { clearedStatus: 'RECONCILED' },
    })
    const done = await tx.bankReconciliation.update({
      where: { id: reconciliationId },
      data: { status: 'COMPLETED', finishedAt: new Date(), finishedBy: userId },
    })
    await tx.auditLog.create({
      data: {
        entityId,
        userId,
        action: 'RECONCILIATION_COMPLETED',
        resource: 'BankReconciliation',
        resourceId: reconciliationId,
        newValue: JSON.stringify({
          endingBalance: Number(done.endingBalance),
          clearedCount: state.summary.clearedCount,
        }),
      },
    })
    return done
  })
}

// ─── small parsing helpers ─────────────────────────────────────────────────────

function splitCsvRow(row: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < row.length; i++) {
    const ch = row[i]
    if (ch === '"') {
      if (inQuotes && row[i + 1] === '"') {
        cur += '"'
        i++
      } else inQuotes = !inQuotes
    } else if (ch === ',' && !inQuotes) {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out
}

function parseMoney(s: string | undefined): number {
  if (!s) return 0
  let v = s.replace(/[$,\s]/g, '').trim()
  let neg = false
  if (/^\(.*\)$/.test(v)) {
    neg = true
    v = v.replace(/[()]/g, '')
  }
  const n = parseFloat(v)
  if (isNaN(n)) return 0
  return neg ? -n : n
}

function parseFlexDate(s: string | undefined): Date | null {
  if (!s) return null
  const t = s.trim()
  // YYYYMMDD (OFX)
  if (/^\d{8}$/.test(t)) {
    const d = new Date(`${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}`)
    return isNaN(d.getTime()) ? null : d
  }
  // MM/DD/YYYY or DD/MM/YYYY (assume US MM/DD first)
  const slash = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/)
  if (slash) {
    let [, a, b, y] = slash
    if (y.length === 2) y = `20${y}`
    const d = new Date(Number(y), Number(a) - 1, Number(b))
    return isNaN(d.getTime()) ? null : d
  }
  const d = new Date(t)
  return isNaN(d.getTime()) ? null : d
}

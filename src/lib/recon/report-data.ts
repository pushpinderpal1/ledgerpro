/**
 * Bank reconciliation report — pure data preparation.
 *
 * Takes the reconciliation state (as produced by getReconciliationState)
 * and turns it into a shape that's easy for both Excel and PDF renderers
 * to consume. No DB calls, no library imports — trivially testable.
 *
 * Tick convention (per user spec):
 *   ✓  cleared and recon is COMPLETED   → also shows clearedDate
 *   *  cleared but recon is IN_PROGRESS → no clearedDate column value
 *   (blank) uncleared
 */

export type TickMark = '✓' | '*' | ''

export interface ReconLineInput {
  id: string
  date: string | Date
  ref: string
  description: string | null
  debit: number
  credit: number
  clearedStatus: 'UNCLEARED' | 'CLEARED' | 'RECONCILED'
  clearedDate: string | Date | null
  inThisRecon: boolean
}

export interface ReconSummaryInput {
  beginningBalance: number
  endingBalance: number
  clearedBalance: number
  clearedCount: number
  unclearedCount: number
  difference: number
  isBalanced: boolean
}

export interface ReconReportInput {
  entityName: string
  bankAccount: { code: string; name: string }
  statementDate: Date | string
  status: 'IN_PROGRESS' | 'COMPLETED'
  cleared: ReconLineInput[]
  uncleared: ReconLineInput[]
  summary: ReconSummaryInput
  generatedAt?: Date
  generatedBy?: string
}

export interface ReconReportTxn {
  date: string             // YYYY-MM-DD
  ref: string
  description: string
  debit: number
  credit: number
  tick: TickMark
  clearedDate: string      // YYYY-MM-DD or empty
}

export interface ReconReportData {
  header: {
    entityName: string
    accountCode: string
    accountName: string
    statementDate: string
    status: 'IN_PROGRESS' | 'COMPLETED'
    generatedAt: string
  }
  summary: {
    beginningBalance: number
    statementEnding: number
    clearedBalance: number
    bookBalance: number
    outstandingDeposits: number     // uncleared debits (cash coming in not yet on statement)
    outstandingWithdrawals: number  // uncleared credits (cash going out not yet on statement)
    adjustedBankBalance: number     // statementEnding + outstandingDeposits - outstandingWithdrawals
    difference: number
    isBalanced: boolean
    clearedCount: number
    unclearedCount: number
  }
  transactions: ReconReportTxn[]    // both cleared and uncleared, sorted by date
}

const toISO = (d: string | Date | null): string => {
  if (!d) return ''
  const dt = typeof d === 'string' ? new Date(d) : d
  return dt.toISOString().slice(0, 10)
}

function tickFor(line: ReconLineInput, reconStatus: 'IN_PROGRESS' | 'COMPLETED'): TickMark {
  if (!line.inThisRecon) return ''
  if (line.clearedStatus === 'UNCLEARED') return ''
  return reconStatus === 'COMPLETED' ? '✓' : '*'
}

export function buildReconReportData(input: ReconReportInput): ReconReportData {
  // Compute outstanding amounts from the uncleared list. On a bank account,
  // debit = deposit (incoming), credit = withdrawal (outgoing).
  let outDeposits = 0
  let outWithdrawals = 0
  for (const l of input.uncleared) {
    outDeposits += l.debit
    outWithdrawals += l.credit
  }

  // Book balance = beginning + sum of ALL movements (cleared and uncleared).
  // clearedBalance already includes beginning + cleared movements, so:
  const unclearedNet = outDeposits - outWithdrawals
  const bookBalance = input.summary.clearedBalance + unclearedNet

  // Adjusted bank balance = statement ending + outstanding deposits (we have
  // them, bank doesn't yet) − outstanding withdrawals (we have them, bank
  // hasn't paid them yet). When reconciled, this equals the book balance.
  const adjustedBankBalance = input.summary.endingBalance + outDeposits - outWithdrawals

  const all: ReconReportTxn[] = [...input.cleared, ...input.uncleared].map(l => ({
    date: toISO(l.date),
    ref: l.ref,
    description: l.description ?? '',
    debit: l.debit,
    credit: l.credit,
    tick: tickFor(l, input.status),
    clearedDate: input.status === 'COMPLETED' && l.inThisRecon && l.clearedStatus !== 'UNCLEARED'
      ? toISO(l.clearedDate)
      : '',
  })).sort((a, b) => a.date.localeCompare(b.date) || a.ref.localeCompare(b.ref))

  return {
    header: {
      entityName: input.entityName,
      accountCode: input.bankAccount.code,
      accountName: input.bankAccount.name,
      statementDate: toISO(input.statementDate),
      status: input.status,
      generatedAt: (input.generatedAt ?? new Date()).toISOString(),
    },
    summary: {
      beginningBalance: input.summary.beginningBalance,
      statementEnding: input.summary.endingBalance,
      clearedBalance: input.summary.clearedBalance,
      bookBalance,
      outstandingDeposits: outDeposits,
      outstandingWithdrawals: outWithdrawals,
      adjustedBankBalance,
      difference: input.summary.difference,
      isBalanced: input.summary.isBalanced,
      clearedCount: input.summary.clearedCount,
      unclearedCount: input.summary.unclearedCount,
    },
    transactions: all,
  }
}

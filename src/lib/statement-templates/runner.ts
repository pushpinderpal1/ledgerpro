/**
 * Custom Statement Template — pure runner.
 *
 * Given:
 *   - a template (an ordered list of lines)
 *   - a map of accountId → naturalBalance for the period
 *   - a map of accountId → account metadata (code, name, type)
 *
 * Returns an ordered list of rendered rows, each with a label and value
 * (or null value for header/spacer rows). Designed to be DB-agnostic and
 * trivially testable.
 *
 * Sign convention:
 *   - "Natural balance" means: positive when the account behaves naturally
 *     (revenue with credits > debits is positive; expense with debits
 *     > credits is positive).
 *   - This is what users expect to see on a P&L or BS layout.
 *   - The `invert` flag on a line flips this for special cases (e.g.
 *     showing contra-revenue as a negative deduction).
 */

export type AccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE' | 'COGS'

export type LineType = 'HEADER' | 'ACCOUNT' | 'GROUP' | 'SUBTOTAL' | 'SPACER'

export interface StatementLine {
  id: string                 // stable identifier for editing (frontend-generated)
  type: LineType
  label: string
  accountId?: string         // for ACCOUNT
  accountIds?: string[]      // for GROUP
  invert?: boolean           // for ACCOUNT / GROUP
  bold?: boolean             // visual emphasis flag (also auto-set on SUBTOTAL)
}

export interface AccountMeta {
  id: string
  code: string
  name: string
  type: AccountType
}

export interface RenderedRow {
  type: LineType
  label: string
  value: number | null
  bold: boolean
  // For drill-down: which account IDs contributed to this row, if any.
  accountIds: string[]
}

/**
 * Natural balance from a raw debit-credit signed amount.
 * Raw amount uses the journal convention: debit positive, credit negative.
 */
export function naturalBalance(rawSigned: number, type: AccountType): number {
  if (type === 'ASSET' || type === 'EXPENSE' || type === 'COGS') return rawSigned
  return -rawSigned                                          // LIABILITY, EQUITY, REVENUE
}

export interface RunInputs {
  lines: StatementLine[]
  /** raw debit-credit balance per account in this period (debit − credit). */
  rawByAccount: Map<string, number>
  /** account metadata by accountId. */
  accountsById: Map<string, AccountMeta>
}

export function runTemplate(inputs: RunInputs): { rows: RenderedRow[]; grandTotal: number } {
  const { lines, rawByAccount, accountsById } = inputs
  const rows: RenderedRow[] = []

  // Track values produced since the last SUBTOTAL line.
  // SUBTOTAL sums these and resets.
  let runningSubtotal = 0
  let runningGrandTotal = 0

  const lineValue = (line: StatementLine): { value: number | null; accountIds: string[] } => {
    if (line.type === 'ACCOUNT') {
      const meta = line.accountId ? accountsById.get(line.accountId) : undefined
      if (!meta) return { value: 0, accountIds: line.accountId ? [line.accountId] : [] }
      const raw = rawByAccount.get(line.accountId!) ?? 0
      let v = naturalBalance(raw, meta.type)
      if (line.invert) v = -v
      return { value: v, accountIds: [line.accountId!] }
    }
    if (line.type === 'GROUP') {
      const ids = line.accountIds ?? []
      let v = 0
      for (const id of ids) {
        const meta = accountsById.get(id)
        if (!meta) continue
        v += naturalBalance(rawByAccount.get(id) ?? 0, meta.type)
      }
      if (line.invert) v = -v
      return { value: v, accountIds: ids }
    }
    return { value: null, accountIds: [] }
  }

  for (const line of lines) {
    if (line.type === 'HEADER' || line.type === 'SPACER') {
      rows.push({
        type: line.type,
        label: line.type === 'SPACER' ? '' : line.label,
        value: null,
        bold: !!line.bold || line.type === 'HEADER',
        accountIds: [],
      })
      continue
    }
    if (line.type === 'SUBTOTAL') {
      rows.push({
        type: 'SUBTOTAL',
        label: line.label,
        value: runningSubtotal,
        bold: true,
        accountIds: [],
      })
      runningGrandTotal += runningSubtotal
      runningSubtotal = 0
      continue
    }
    // ACCOUNT or GROUP
    const { value, accountIds } = lineValue(line)
    rows.push({
      type: line.type,
      label: line.label,
      value,
      bold: !!line.bold,
      accountIds,
    })
    if (value !== null) runningSubtotal += value
  }

  // If there are values after the last SUBTOTAL, add them to the grand total.
  runningGrandTotal += runningSubtotal

  return { rows, grandTotal: runningGrandTotal }
}

/** Validate a template's lines. Returns array of error messages (empty = OK). */
export function validateTemplate(lines: StatementLine[]): string[] {
  const errors: string[] = []
  if (!Array.isArray(lines) || lines.length === 0) errors.push('Template must have at least one line')
  const seenIds = new Set<string>()
  lines.forEach((l, i) => {
    if (!l.id || typeof l.id !== 'string') errors.push(`Line ${i + 1}: missing id`)
    else if (seenIds.has(l.id)) errors.push(`Line ${i + 1}: duplicate id ${l.id}`)
    seenIds.add(l.id)
    if (!['HEADER', 'ACCOUNT', 'GROUP', 'SUBTOTAL', 'SPACER'].includes(l.type)) {
      errors.push(`Line ${i + 1}: invalid type ${l.type}`)
    }
    if (l.type === 'ACCOUNT' && !l.accountId) errors.push(`Line ${i + 1}: ACCOUNT line missing accountId`)
    if (l.type === 'GROUP' && (!l.accountIds || l.accountIds.length === 0)) {
      errors.push(`Line ${i + 1}: GROUP line missing accountIds`)
    }
    if (l.type !== 'SPACER' && (!l.label || l.label.trim() === '')) {
      errors.push(`Line ${i + 1}: label required for non-spacer lines`)
    }
  })
  return errors
}

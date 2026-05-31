/**
 * Pure statement-parsing functions. No DB or framework dependencies, so this
 * file is freely importable from tests and from environments without Prisma.
 *
 * Supports CSV (various layouts) and OFX/QFX (Quicken/QuickBooks export).
 */

export interface ParsedStatementLine {
  date: Date
  description: string
  amount: number     // signed: + deposit, - withdrawal
  reference?: string
}

const toCents = (n: unknown) => Math.round(Number(n ?? 0) * 100)
const fromCents = (c: number) => c / 100

// ─── CSV ──────────────────────────────────────────────────────────────────────

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
      amount = credit - debit
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

// ─── OFX/QFX ──────────────────────────────────────────────────────────────────

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

// ─── Helpers (exported for direct testing) ────────────────────────────────────

export function splitCsvRow(row: string): string[] {
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

export function parseMoney(s: string | undefined): number {
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

export function parseFlexDate(s: string | undefined): Date | null {
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

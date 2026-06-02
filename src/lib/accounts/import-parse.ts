import type { IifAccount } from '../iif'

/**
 * Pure parsing for Chart of Accounts imports. No DB.
 *
 * Two formats supported:
 *   1. LedgerPro CSV template — columns: Code, Name, Type, SubType, Description, Parent Code
 *   2. QuickBooks IIF (!ACCNT block) — re-uses src/lib/iif's existing parser
 *
 * Both are normalized to the same `ParsedAccountRow` shape so the import
 * engine can treat them identically.
 */

export type LpAccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE' | 'COGS'

export interface ParsedAccountRow {
  code: string
  name: string
  type: LpAccountType
  subType?: string
  description?: string
  parentCode?: string                 // for two-pass resolution
  parentName?: string                 // from "Parent:Child" IIF convention
  isBankAccount?: boolean
  openingBalance?: number             // optional column; absent or 0 = no OB JE created
  rawSourceLine?: number              // 1-based line index for error reporting
  warnings: string[]
}

export interface ParseResult {
  rows: ParsedAccountRow[]
  errors: { line?: number; message: string }[]
}

// ─── QuickBooks IIF account-type mapping ─────────────────────────────────────
// QB types (ACCNTTYPE column in !ACCNT block) → our enum.
// Sub-type is preserved verbatim where the QB type carries extra meaning.
//
// Reference: Intuit's IIF documentation.
//
// "BANK"     → ASSET, subType=Bank (also flips isBankAccount=true)
// "AR"       → ASSET, subType=Accounts Receivable
// "OCASSET"  → ASSET, subType=Other Current Asset
// "FIXASSET" → ASSET, subType=Fixed Asset
// "OASSET"   → ASSET, subType=Other Asset
// "AP"       → LIABILITY, subType=Accounts Payable
// "CCARD"    → LIABILITY, subType=Credit Card
// "OCLIAB"   → LIABILITY, subType=Other Current Liability
// "LTLIAB"   → LIABILITY, subType=Long Term Liability
// "EQUITY"   → EQUITY
// "INC"      → REVENUE, subType=Income
// "OINC"     → REVENUE, subType=Other Income
// "COGS"     → COGS
// "EXP"      → EXPENSE
// "OEXP"     → EXPENSE, subType=Other Expense
// "EXEXP"    → EXPENSE, subType=Expense (alt encoding)
// "NONPOSTING" — skipped (not a posting account in LedgerPro terms)
export const QB_ACCOUNT_TYPE_MAP: Record<string, { type: LpAccountType; subType?: string; isBank?: boolean }> = {
  BANK:       { type: 'ASSET',     subType: 'Bank', isBank: true },
  AR:         { type: 'ASSET',     subType: 'Accounts Receivable' },
  OCASSET:    { type: 'ASSET',     subType: 'Other Current Asset' },
  FIXASSET:   { type: 'ASSET',     subType: 'Fixed Asset' },
  OASSET:     { type: 'ASSET',     subType: 'Other Asset' },
  AP:         { type: 'LIABILITY', subType: 'Accounts Payable' },
  CCARD:      { type: 'LIABILITY', subType: 'Credit Card' },
  OCLIAB:     { type: 'LIABILITY', subType: 'Other Current Liability' },
  LTLIAB:     { type: 'LIABILITY', subType: 'Long Term Liability' },
  EQUITY:     { type: 'EQUITY' },
  INC:        { type: 'REVENUE',   subType: 'Income' },
  OINC:       { type: 'REVENUE',   subType: 'Other Income' },
  COGS:       { type: 'COGS' },
  EXP:        { type: 'EXPENSE' },
  EXEXP:      { type: 'EXPENSE' },
  OEXP:       { type: 'EXPENSE',   subType: 'Other Expense' },
}

// ─── LedgerPro CSV template ───────────────────────────────────────────────────
// Header: Code, Name, Type, SubType, Description, Parent Code
// All columns case-insensitive. Code and Name are required.

export const CSV_TEMPLATE_HEADER = ['Code', 'Name', 'Type', 'SubType', 'Description', 'Parent Code', 'Opening Balance']

export const CSV_TEMPLATE_SAMPLE = [
  CSV_TEMPLATE_HEADER.join(','),
  '1000,Cash - Operating,ASSET,Bank,Primary checking account,,5000.00',
  '1010,Cash - Petty,ASSET,Bank,Petty cash on hand,,250.00',
  '1100,Accounts Receivable,ASSET,Accounts Receivable,Customer balances,,',
  '1500,Fixed Assets,ASSET,Fixed Asset,Equipment and machinery,,',
  '1510,Accumulated Depreciation,ASSET,Fixed Asset,Contra-asset; credit-balance,1500,',
  '2000,Accounts Payable,LIABILITY,Accounts Payable,Vendor balances,,',
  '3000,Owner\'s Equity,EQUITY,,Equity capital,,',
  '4000,Sales Revenue,REVENUE,Income,Revenue from sales,,',
  '5000,Cost of Goods Sold,COGS,,Direct cost of products sold,,',
  '6000,Operating Expenses,EXPENSE,,General operating expenses,,',
  '6100,Rent Expense,EXPENSE,,Office rent,6000,',
  '6200,Depreciation Expense,EXPENSE,,Depreciation for the period,6000,',
].join('\n') + '\n'

const VALID_TYPES = new Set(['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE', 'COGS'])

export function parseCsvAccounts(content: string): ParseResult {
  const errors: ParseResult['errors'] = []
  const rows: ParsedAccountRow[] = []
  const lines = content.split(/\r?\n/).filter(l => l.trim().length > 0)
  if (lines.length === 0) return { rows: [], errors: [{ message: 'File is empty' }] }

  const headers = splitCsvRow(lines[0]).map(h => h.trim().toLowerCase())
  const findIdx = (...names: string[]) => headers.findIndex(h => names.some(n => h === n || h.replace(/[ _-]/g, '') === n.replace(/[ _-]/g, '')))

  const iCode = findIdx('code', 'account code', 'accnum')
  const iName = findIdx('name', 'account name', 'accountname')
  const iType = findIdx('type', 'account type', 'accounttype')
  const iSubType = findIdx('subtype', 'sub type', 'sub-type')
  const iDesc = findIdx('description', 'desc')
  const iParent = findIdx('parent code', 'parent', 'parentcode')
  const iOpeningBalance = findIdx('opening balance', 'openingbalance', 'opening', 'ob')

  if (iCode < 0 || iName < 0) {
    return { rows: [], errors: [{ message: 'CSV must include at least "Code" and "Name" columns' }] }
  }

  for (let r = 1; r < lines.length; r++) {
    const cells = splitCsvRow(lines[r])
    const lineNum = r + 1
    const code = (cells[iCode] ?? '').trim()
    const name = (cells[iName] ?? '').trim()
    if (!code || !name) {
      if (code || name || cells.some(c => c.trim())) {
        errors.push({ line: lineNum, message: 'Skipped: code and name are both required' })
      }
      continue
    }
    const rawType = iType >= 0 ? (cells[iType] ?? '').trim().toUpperCase() : ''
    let type: LpAccountType
    let subTypeFromMap: string | undefined
    let isBank: boolean | undefined
    if (VALID_TYPES.has(rawType)) {
      type = rawType as LpAccountType
    } else if (rawType in QB_ACCOUNT_TYPE_MAP) {
      // Tolerant: if someone enters a QB type code in the CSV, map it.
      const m = QB_ACCOUNT_TYPE_MAP[rawType]
      type = m.type; subTypeFromMap = m.subType; isBank = m.isBank
    } else if (!rawType) {
      errors.push({ line: lineNum, message: `Missing type for "${name}" (${code})` })
      continue
    } else {
      errors.push({ line: lineNum, message: `Unknown type "${rawType}" for "${name}" — expected one of ASSET/LIABILITY/EQUITY/REVENUE/EXPENSE/COGS` })
      continue
    }
    const subType = (iSubType >= 0 ? (cells[iSubType] ?? '').trim() : '') || subTypeFromMap || undefined
    const description = iDesc >= 0 ? (cells[iDesc] ?? '').trim() || undefined : undefined
    const parentCode = iParent >= 0 ? (cells[iParent] ?? '').trim() || undefined : undefined

    // Optional opening balance — strip $ and , for tolerance; skip if blank or zero
    let openingBalance: number | undefined
    if (iOpeningBalance >= 0) {
      const raw = (cells[iOpeningBalance] ?? '').trim().replace(/[$,]/g, '')
      if (raw) {
        const n = parseFloat(raw)
        if (Number.isFinite(n)) {
          if (n !== 0) openingBalance = n
        } else {
          errors.push({ line: lineNum, message: `Invalid opening balance "${raw}" for ${code} - ${name}` })
        }
      }
    }

    rows.push({
      code, name, type, subType, description, parentCode,
      isBankAccount: isBank,
      openingBalance,
      rawSourceLine: lineNum,
      warnings: [],
    })
  }
  return { rows, errors }
}

// ─── IIF (!ACCNT) ─────────────────────────────────────────────────────────────
// Normalize parsed IIF account rows into the same shape. IIF encodes
// sub-accounts with colon-separated names like "Cash:Petty Cash". We split
// that to extract a parentName the import engine can resolve in pass 2.

export function normalizeIifAccounts(accts: IifAccount[]): ParseResult {
  const errors: ParseResult['errors'] = []
  const rows: ParsedAccountRow[] = []
  for (let i = 0; i < accts.length; i++) {
    const a = accts[i]
    if (!a.name || !a.name.trim()) {
      errors.push({ message: `IIF row ${i + 1}: missing NAME` })
      continue
    }
    const qbType = (a.accntType ?? '').toUpperCase().trim()
    const mapped = QB_ACCOUNT_TYPE_MAP[qbType]
    if (!mapped) {
      errors.push({ message: `IIF row ${i + 1} ("${a.name}"): unknown account type "${qbType}" — skipped` })
      continue
    }

    // Split colon-separated names into parent / leaf.
    const segments = a.name.split(':').map(s => s.trim()).filter(Boolean)
    const leafName = segments[segments.length - 1]
    const parentName = segments.length > 1 ? segments.slice(0, -1).join(':') : undefined

    // Code: prefer ACCNUM, but generate a placeholder if absent so import
    // can still happen. Synthesized codes use a sentinel that the UI flags.
    const code = (a.accNum && a.accNum.trim()) ? a.accNum.trim() : `IIF-${i + 1}`
    const warnings: string[] = []
    if (!a.accNum || !a.accNum.trim()) {
      warnings.push('No account number in IIF — auto-assigned a placeholder; edit before posting transactions')
    }

    rows.push({
      code,
      name: leafName,
      type: mapped.type,
      subType: mapped.subType,
      description: a.description?.trim() || undefined,
      parentName,
      isBankAccount: mapped.isBank,
      rawSourceLine: i + 1,
      warnings,
    })
  }
  return { rows, errors }
}

// ─── Small CSV row splitter (RFC-4180 quoting) ────────────────────────────────
export function splitCsvRow(row: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < row.length; i++) {
    const ch = row[i]
    if (ch === '"') {
      if (inQuotes && row[i + 1] === '"') { cur += '"'; i++ }
      else inQuotes = !inQuotes
    } else if (ch === ',' && !inQuotes) {
      out.push(cur); cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out
}

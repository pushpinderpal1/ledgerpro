// QuickBooks IIF (Intuit Interchange Format) parser and generator

export interface IifTransaction {
  trnsId?: string
  trnsType: string
  date: string
  account: string
  name?: string
  amount: number
  memo?: string
  splits: IifSplit[]
}

export interface IifSplit {
  splId?: string
  trnsType: string
  date: string
  account: string
  name?: string
  amount: number
  memo?: string
}

export interface IifAccount {
  name: string
  accntType: string
  description?: string
  accNum?: string
  extra?: string
}

export interface IifPayroll {
  emplId: string
  lastName: string
  firstName: string
  wages: number
  fedTax: number
  ssTax: number
  medTax: number
  stateTax?: number
}

export interface ParsedIif {
  type: 'TRNS' | 'ACCNT' | 'PAYROLL' | 'MIXED'
  transactions: IifTransaction[]
  accounts: IifAccount[]
  payroll: IifPayroll[]
  errors: string[]
  rowCount: number
}

// ─── PARSER ──────────────────────────────────────────────────────────────────

export function parseIif(content: string): ParsedIif {
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  const result: ParsedIif = {
    type: 'MIXED',
    transactions: [],
    accounts: [],
    payroll: [],
    errors: [],
    rowCount: 0,
  }

  let trnsHeaders: string[] = []
  let splHeaders: string[] = []
  let accntHeaders: string[] = []
  let payrollHeaders: string[] = []
  let currentTrns: IifTransaction | null = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line || line.startsWith(';')) continue

    const cols = line.split('\t')
    const tag = cols[0].toUpperCase()

    try {
      if (tag === '!TRNS') {
        trnsHeaders = cols.slice(1)
      } else if (tag === '!SPL') {
        splHeaders = cols.slice(1)
      } else if (tag === '!ACCNT') {
        accntHeaders = cols.slice(1)
      } else if (tag === '!PAYROLL') {
        payrollHeaders = cols.slice(1)
      } else if (tag === 'TRNS') {
        currentTrns = mapToObject(trnsHeaders, cols.slice(1)) as unknown as IifTransaction
        currentTrns.splits = []
        currentTrns.amount = parseFloat(String(currentTrns.amount)) || 0
        result.rowCount++
      } else if (tag === 'SPL' && currentTrns) {
        const spl = mapToObject(splHeaders, cols.slice(1)) as unknown as IifSplit
        spl.amount = parseFloat(String(spl.amount)) || 0
        currentTrns.splits.push(spl)
        result.rowCount++
      } else if (tag === 'ENDTRNS' && currentTrns) {
        result.transactions.push(currentTrns)
        currentTrns = null
      } else if (tag === 'ACCNT') {
        const acct = mapToObject(accntHeaders, cols.slice(1)) as unknown as IifAccount
        result.accounts.push(acct)
        result.rowCount++
      } else if (tag === 'ENDACCNT') {
        // done
      } else if (tag === 'PAYROLL') {
        const pr = mapToObject(payrollHeaders, cols.slice(1)) as unknown as IifPayroll
        pr.wages = parseFloat(String(pr.wages)) || 0
        pr.fedTax = parseFloat(String(pr.fedTax)) || 0
        pr.ssTax = parseFloat(String(pr.ssTax)) || 0
        pr.medTax = parseFloat(String(pr.medTax)) || 0
        result.payroll.push(pr)
        result.rowCount++
      }
    } catch (e) {
      result.errors.push(`Line ${i + 1}: ${e instanceof Error ? e.message : 'Parse error'}`)
    }
  }

  if (result.transactions.length > 0 && result.accounts.length === 0) result.type = 'TRNS'
  else if (result.accounts.length > 0 && result.transactions.length === 0) result.type = 'ACCNT'
  else if (result.payroll.length > 0) result.type = 'PAYROLL'

  return result
}

function mapToObject(headers: string[], values: string[]): Record<string, string | number> {
  const obj: Record<string, string | number> = {}
  const keyMap: Record<string, string> = {
    TRNSID: 'trnsId', TRNSTYPE: 'trnsType', DATE: 'date', ACCNT: 'account',
    NAME: 'name', AMOUNT: 'amount', MEMO: 'memo', SPLID: 'splId',
    ACCNTTYPE: 'accntType', DESC: 'description', ACCNUM: 'accNum',
    EMPLID: 'emplId', LASTNAME: 'lastName', FIRSTNAME: 'firstName',
    WAGES: 'wages', FEDTAX: 'fedTax', SSTAX: 'ssTax', MEDTAX: 'medTax',
    STATETAX: 'stateTax',
  }
  headers.forEach((h, idx) => {
    const key = keyMap[h.toUpperCase()] ?? h.toLowerCase()
    obj[key] = values[idx] ?? ''
  })
  return obj
}

// ─── GENERATOR ───────────────────────────────────────────────────────────────

export function generateTransactionIif(transactions: IifTransaction[]): string {
  const lines: string[] = []
  lines.push('!TRNS\tTRNSID\tTRNSTYPE\tDATE\tACCNT\tNAME\tAMOUNT\tMEMO')
  lines.push('!SPL\tSPLID\tTRNSTYPE\tDATE\tACCNT\tNAME\tAMOUNT\tMEMO')
  lines.push('!ENDTRNS')

  transactions.forEach((t, ti) => {
    const date = formatIifDate(t.date)
    lines.push(`TRNS\t${t.trnsId ?? ti + 1}\t${t.trnsType}\t${date}\t${t.account}\t${t.name ?? ''}\t${t.amount.toFixed(2)}\t${t.memo ?? ''}`)
    t.splits.forEach((s, si) => {
      lines.push(`SPL\t${s.splId ?? `${ti + 1}-${si + 1}`}\t${s.trnsType}\t${date}\t${s.account}\t${s.name ?? ''}\t${s.amount.toFixed(2)}\t${s.memo ?? ''}`)
    })
    lines.push('ENDTRNS')
  })

  return lines.join('\r\n')
}

export function generateAccountIif(accounts: IifAccount[]): string {
  const lines: string[] = []
  lines.push('!ACCNT\tNAME\tACCNTTYPE\tDESC\tACCNUM')
  lines.push('!ENDACCNT')

  accounts.forEach(a => {
    lines.push(`ACCNT\t${a.name}\t${a.accntType}\t${a.description ?? ''}\t${a.accNum ?? ''}`)
    lines.push('ENDACCNT')
  })

  return lines.join('\r\n')
}

export function generatePayrollIif(payroll: IifPayroll[]): string {
  const lines: string[] = []
  lines.push('!PAYROLL\tEMPLID\tLASTNAME\tFIRSTNAME\tWAGES\tFEDTAX\tSSTAX\tMEDTAX\tSTATETAX')
  lines.push('!ENDPAYROLL')

  payroll.forEach(p => {
    lines.push(`PAYROLL\t${p.emplId}\t${p.lastName}\t${p.firstName}\t${p.wages.toFixed(2)}\t${p.fedTax.toFixed(2)}\t${p.ssTax.toFixed(2)}\t${p.medTax.toFixed(2)}\t${(p.stateTax ?? 0).toFixed(2)}`)
    lines.push('ENDPAYROLL')
  })

  return lines.join('\r\n')
}

// QuickBooks date format: MM/DD/YYYY
function formatIifDate(dateStr: string): string {
  const d = new Date(dateStr)
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`
}

// Map account types to QB IIF account types
export const ACCOUNT_TYPE_TO_IIF: Record<string, string> = {
  ASSET: 'Bank',
  LIABILITY: 'AP',
  EQUITY: 'Equity',
  REVENUE: 'Inc',
  EXPENSE: 'Exp',
  COGS: 'COGS',
}

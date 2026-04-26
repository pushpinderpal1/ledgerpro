// 2024 Federal Tax Withholding — Publication 15-T Method
// Supports: Single, Married, MFS, HH filing statuses

export interface PayrollInput {
  grossPay: number
  payPeriods: number     // 12=monthly, 24=semi-monthly, 26=bi-weekly, 52=weekly
  filingStatus: 'SINGLE' | 'MARRIED' | 'MFS' | 'HH'
  allowances: number
  state: string
  retirement401k: number // decimal, e.g. 0.03 = 3%
  healthDeduction: number // flat dollar amount per period
}

export interface PayrollResult {
  grossPay: number
  preTaxDeductions: number
  federalTaxableWages: number
  fedTax: number
  stateTax: number
  ssTax: number
  medicareTax: number
  additionalMedicare: number
  totalTax: number
  retirement: number
  healthDeduction: number
  totalDeductions: number
  netPay: number
}

// ─── 2024 Federal Tax Brackets (annualized) ───────────────────────────────────

const FED_BRACKETS: Record<string, Array<[number, number, number]>> = {
  SINGLE: [
    [0,       11600,  0.10],
    [11600,   47150,  0.12],
    [47150,   100525, 0.22],
    [100525,  191950, 0.24],
    [191950,  243725, 0.32],
    [243725,  609350, 0.35],
    [609350,  Infinity, 0.37],
  ],
  MARRIED: [
    [0,       23200,  0.10],
    [23200,   94300,  0.12],
    [94300,   201050, 0.22],
    [201050,  383900, 0.24],
    [383900,  487450, 0.32],
    [487450,  731200, 0.35],
    [731200,  Infinity, 0.37],
  ],
  MFS: [
    [0,       11600,  0.10],
    [11600,   47150,  0.12],
    [47150,   100525, 0.22],
    [100525,  191950, 0.24],
    [191950,  243725, 0.32],
    [243725,  365600, 0.35],
    [365600,  Infinity, 0.37],
  ],
  HH: [
    [0,       16550,  0.10],
    [16550,   63100,  0.12],
    [63100,   100500, 0.22],
    [100500,  191950, 0.24],
    [191950,  243700, 0.32],
    [243700,  609350, 0.35],
    [609350,  Infinity, 0.37],
  ],
}

// 2024 Standard withholding allowance: $4,300
const ALLOWANCE_VALUE = 4300

// FICA 2024
const SS_RATE = 0.062
const SS_WAGE_BASE = 168600
const MEDICARE_RATE = 0.0145
const ADDITIONAL_MEDICARE_RATE = 0.009
const ADDITIONAL_MEDICARE_THRESHOLD: Record<string, number> = {
  SINGLE: 200000, MARRIED: 250000, MFS: 125000, HH: 200000,
}

// ─── State tax tables (simplified flat/bracket approach) ──────────────────────
const STATE_TAX: Record<string, (wages: number, status: string) => number> = {
  NY: (w) => {
    if (w <= 8500) return w * 0.04
    if (w <= 11700) return 340 + (w - 8500) * 0.045
    if (w <= 13900) return 484 + (w - 11700) * 0.0525
    if (w <= 21400) return 600 + (w - 13900) * 0.059
    if (w <= 80650) return 1042 + (w - 21400) * 0.0597
    if (w <= 215400) return 4582 + (w - 80650) * 0.0633
    if (w <= 1077550) return 13118 + (w - 215400) * 0.0685
    return 72161 + (w - 1077550) * 0.0965
  },
  CA: (w) => {
    if (w <= 10099) return w * 0.01
    if (w <= 23942) return 101 + (w - 10099) * 0.02
    if (w <= 37788) return 378 + (w - 23942) * 0.04
    if (w <= 52455) return 932 + (w - 37788) * 0.06
    if (w <= 66295) return 1812 + (w - 52455) * 0.08
    if (w <= 338639) return 2919 + (w - 66295) * 0.093
    if (w <= 406364) return 28246 + (w - 338639) * 0.103
    if (w <= 677275) return 35222 + (w - 406364) * 0.113
    return 65886 + (w - 677275) * 0.123
  },
  TX: () => 0, // No state income tax
  FL: () => 0, // No state income tax
  WA: () => 0, // No state income tax
  NV: () => 0,
  IL: (w) => w * 0.0495,
  PA: (w) => w * 0.0307,
  OH: (w) => {
    if (w <= 26050) return 0
    if (w <= 100000) return (w - 26050) * 0.02765
    return 2044 + (w - 100000) * 0.03226
  },
}

// ─── Main calculation ─────────────────────────────────────────────────────────

export function calculatePayroll(input: PayrollInput): PayrollResult {
  const { grossPay, payPeriods, filingStatus, allowances, state,
          retirement401k, healthDeduction } = input

  // Pre-tax deductions
  const retirementAmt = parseFloat((grossPay * retirement401k).toFixed(2))
  const preTaxDeductions = retirementAmt + healthDeduction

  // Federal taxable wages
  const federalTaxableWages = Math.max(0, grossPay - preTaxDeductions)

  // Annualize
  const annualWages = federalTaxableWages * payPeriods
  const annualAllowances = allowances * ALLOWANCE_VALUE
  const annualTaxable = Math.max(0, annualWages - annualAllowances)

  // Federal tax (annualized then per-period)
  const annualFedTax = calcBracketTax(annualTaxable, FED_BRACKETS[filingStatus] ?? FED_BRACKETS.SINGLE)
  const fedTax = parseFloat((annualFedTax / payPeriods).toFixed(2))

  // State tax (annualized then per-period)
  const stateCalc = STATE_TAX[state.toUpperCase()]
  const annualStateTax = stateCalc ? stateCalc(annualWages, filingStatus) : 0
  const stateTax = parseFloat((annualStateTax / payPeriods).toFixed(2))

  // FICA — based on gross (not reduced by 401k for SS/Medicare)
  const ytdWages = grossPay * payPeriods // simplified YTD estimate
  const ssTax = ytdWages <= SS_WAGE_BASE
    ? parseFloat((grossPay * SS_RATE).toFixed(2))
    : parseFloat((Math.max(0, SS_WAGE_BASE - (ytdWages - grossPay)) * SS_RATE).toFixed(2))

  const medicareTax = parseFloat((grossPay * MEDICARE_RATE).toFixed(2))

  // Additional Medicare (0.9% over threshold — simplified)
  const threshold = ADDITIONAL_MEDICARE_THRESHOLD[filingStatus] ?? 200000
  const addlMedicare = ytdWages > threshold
    ? parseFloat((grossPay * ADDITIONAL_MEDICARE_RATE).toFixed(2))
    : 0

  const totalTax = fedTax + stateTax + ssTax + medicareTax + addlMedicare
  const totalDeductions = totalTax + preTaxDeductions
  const netPay = parseFloat((grossPay - totalDeductions).toFixed(2))

  return {
    grossPay,
    preTaxDeductions,
    federalTaxableWages,
    fedTax,
    stateTax,
    ssTax,
    medicareTax,
    additionalMedicare: addlMedicare,
    totalTax,
    retirement: retirementAmt,
    healthDeduction,
    totalDeductions,
    netPay,
  }
}

function calcBracketTax(income: number, brackets: Array<[number, number, number]>): number {
  let tax = 0
  for (const [low, high, rate] of brackets) {
    if (income <= low) break
    const taxable = Math.min(income, high) - low
    tax += taxable * rate
  }
  return tax
}

// ─── W-2 population from payroll runs ────────────────────────────────────────

export interface W2Input {
  payrollRuns: Array<{
    grossPay: number
    fedTax: number
    ssTax: number
    medicareTax: number
    retirement: number
  }>
}

export interface W2Boxes {
  box1:  number // Federal wages
  box2:  number // Federal income tax withheld
  box3:  number // Social security wages
  box4:  number // Social security tax withheld
  box5:  number // Medicare wages
  box6:  number // Medicare tax withheld
  box12Code?: string
  box12Amount?: number
  box13Retire: boolean
}

export function computeW2(input: W2Input): W2Boxes {
  let totalGross = 0, totalFed = 0, totalSs = 0, totalMed = 0, totalRetire = 0

  for (const run of input.payrollRuns) {
    totalGross   += run.grossPay
    totalFed     += run.fedTax
    totalSs      += run.ssTax
    totalMed     += run.medicareTax
    totalRetire  += run.retirement
  }

  const r = (n: number) => parseFloat(n.toFixed(2))

  return {
    box1:  r(totalGross - totalRetire),
    box2:  r(totalFed),
    box3:  r(Math.min(totalGross, SS_WAGE_BASE)),
    box4:  r(totalSs),
    box5:  r(totalGross),
    box6:  r(totalMed),
    box12Code: totalRetire > 0 ? 'D' : undefined,
    box12Amount: totalRetire > 0 ? r(totalRetire) : undefined,
    box13Retire: totalRetire > 0,
  }
}

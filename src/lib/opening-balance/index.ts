/**
 * Opening balance accounting logic — pure functions only, no DB calls.
 *
 * Each account can have an "opening balance" set when migrating data from a
 * prior system. To keep this consistent with everything-flows-through-JEs,
 * we auto-generate a balanced journal entry for each non-zero opening balance:
 *
 *   For Asset / Expense / COGS (DEBIT-natural):
 *     DR <account>                   amount
 *     CR Opening Balance Equity      amount
 *
 *   For Liability / Equity / Revenue (CREDIT-natural):
 *     DR Opening Balance Equity      amount
 *     CR <account>                   amount
 *
 * Opening Balance Equity (account "3999") is a system-managed equity account
 * that aggregates all opening-balance contras. After all opening balances are
 * entered, OBE's balance equals net assets at migration time — exactly what
 * you'd expect from a clean prior-system handover.
 *
 * If a user enters a NEGATIVE opening balance (rare but valid — e.g. an
 * asset account that started with a credit balance), the sides flip.
 */

export type AccountTypeStr = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE' | 'COGS'

export const OBE_CODE = '3999'
export const OBE_NAME = 'Opening Balance Equity'

export function accountIsDebitNatural(type: AccountTypeStr): boolean {
  return type === 'ASSET' || type === 'EXPENSE' || type === 'COGS'
}

export interface JELineSpec {
  accountId: string
  debit: number
  credit: number
  lineOrder: number
  description?: string
}

/**
 * Compute the two journal-line specs needed to post an opening balance.
 *
 * `openingBalance` is the user-entered number. Positive = natural side.
 * Returns null when openingBalance is exactly zero (no JE needed).
 */
export function computeOpeningBalanceLines(args: {
  account: { id: string; type: AccountTypeStr }
  openingBalance: number
  obeAccountId: string
}): JELineSpec[] | null {
  const { account, openingBalance, obeAccountId } = args
  if (openingBalance === 0) return null

  const debitNatural = accountIsDebitNatural(account.type)
  const amt = Math.abs(openingBalance)
  const negative = openingBalance < 0
  // XOR: positive number on a debit-natural account → debit; flipped if negative
  const accountOnDebitSide = debitNatural !== negative

  return [
    {
      accountId: account.id,
      debit:  accountOnDebitSide ? amt : 0,
      credit: accountOnDebitSide ? 0   : amt,
      lineOrder: 0,
      description: 'Opening balance',
    },
    {
      accountId: obeAccountId,
      debit:  accountOnDebitSide ? 0   : amt,
      credit: accountOnDebitSide ? amt : 0,
      lineOrder: 1,
      description: 'Opening balance contra (OBE)',
    },
  ]
}

/**
 * Returns the entity's opening date or a sensible default (Jan 1 of the
 * current calendar year). Centralized so the API and CSV import agree.
 */
export function resolveOpeningDate(entity: { openingDate: Date | null }, now: Date = new Date()): Date {
  if (entity.openingDate) return entity.openingDate
  return new Date(now.getFullYear(), 0, 1)
}

/**
 * Returns the natural-side display string for a signed (DR-CR) balance.
 *
 *   signed = sum(debit) - sum(credit)  (always in DR-positive convention)
 *
 * For DEBIT-natural accounts, positive signed = on natural side ("DR balance").
 * For CREDIT-natural, negative signed = on natural side ("CR balance").
 */
export function formatNaturalBalance(signed: number, type: AccountTypeStr): {
  amount: number          // always non-negative for display
  side: 'DR' | 'CR' | 'ZERO'
  isUnnatural: boolean    // true when the actual side opposes the account's natural side
} {
  if (signed === 0) return { amount: 0, side: 'ZERO', isUnnatural: false }
  const debitNatural = accountIsDebitNatural(type)
  const side: 'DR' | 'CR' = signed > 0 ? 'DR' : 'CR'
  const isUnnatural = (side === 'DR' && !debitNatural) || (side === 'CR' && debitNatural)
  return { amount: Math.abs(signed), side, isUnnatural }
}

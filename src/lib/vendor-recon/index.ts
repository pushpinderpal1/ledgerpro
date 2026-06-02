import { db } from '../db'

/**
 * Vendor Reconciliation engine.
 *
 * Internal balance = sum of open AP invoice balances for the vendor as of
 * the statement date. We use ApInvoice.balance (the unpaid remainder) on
 * invoices whose date ≤ statementDate, because that's what would appear on a
 * vendor statement dated then.
 *
 * Future v2: line-by-line matching of the vendor's statement lines against
 * specific ApInvoice records, with timing-difference categorization.
 */

export async function computeInternalBalance(
  entityId: string,
  vendor: string,
  asOf: Date,
): Promise<number> {
  // All invoices for this vendor up to the statement date, sum unpaid balances.
  const invoices = await db.apInvoice.findMany({
    where: {
      entityId,
      vendor,
      date: { lte: asOf },
      status: { not: 'VOID' },
    },
    select: { balance: true },
  })
  return invoices.reduce((s, i) => s + Number(i.balance), 0)
}

export async function listVendors(entityId: string): Promise<string[]> {
  const rows = await db.apInvoice.findMany({
    where: { entityId, status: { not: 'VOID' } },
    select: { vendor: true },
    distinct: ['vendor'],
    orderBy: { vendor: 'asc' },
  })
  return rows.map(r => r.vendor)
}

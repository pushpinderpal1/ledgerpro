import { db } from '../db'

/**
 * Vendor Reconciliation engine.
 *
 * Internal balance = sum of (amount − amountPaid) for the vendor's open AP
 * invoices as of the statement date. We include all non-voided invoices
 * whose invoiceDate ≤ statementDate, because that's what would appear on a
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
  // All non-voided invoices for this vendor up to the statement date,
  // sum unpaid remainders (amount - amountPaid).
  const invoices = await db.apInvoice.findMany({
    where: {
      entityId,
      vendor,
      invoiceDate: { lte: asOf },
      status: { not: 'VOID' },
    },
    select: { amount: true, amountPaid: true },
  })
  return invoices.reduce((s, i) => s + (Number(i.amount) - Number(i.amountPaid)), 0)
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

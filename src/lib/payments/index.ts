import { db } from '../db'
import { assertDateUnlocked } from '../periods'
import type { Prisma, PrismaClient } from '@prisma/client'

/**
 * Payments engine — Write Cheque & ACH (QuickBooks-style).
 *
 * Money movement is identical for both methods:
 *   DR  expense / AP / other offset account
 *   CR  bank account (the account the funds are drawn from)
 * The difference is the metadata captured (cheque number vs. ACH routing/trace)
 * and how it's later reconciled.
 *
 * All amounts use integer-cent math to stay exact against Decimal(18,2).
 */

const toCents = (n: unknown) => Math.round(Number(n ?? 0) * 100)
type Tx = Prisma.TransactionClient | PrismaClient

// ─── Next cheque number for a bank account ─────────────────────────────────────
export async function nextChequeNumber(
  entityId: string,
  bankAccountId: string,
  tx: Tx = db
): Promise<string> {
  const last = await tx.payment.findFirst({
    where: { entityId, bankAccountId, method: 'CHEQUE', chequeNo: { not: null } },
    orderBy: { createdAt: 'desc' },
    select: { chequeNo: true },
  })
  const lastNum = last?.chequeNo ? parseInt(last.chequeNo.replace(/\D/g, ''), 10) : 1000
  return String((isNaN(lastNum) ? 1000 : lastNum) + 1)
}

// ─── Next ACH batch / trace ────────────────────────────────────────────────────
export function generateAchBatchId(): string {
  const d = new Date()
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
  const rand = Math.floor(Math.random() * 1e6).toString().padStart(6, '0')
  return `ACH-${stamp}-${rand}`
}

interface CreatePaymentInput {
  entityId: string
  bankAccountId: string
  method: 'CHEQUE' | 'ACH'
  payeeName: string
  payeeClientId?: string
  amount: number
  paymentDate: string
  memo?: string
  expenseAccountId?: string
  apInvoiceId?: string
  createdBy?: string
  // cheque
  chequeNo?: string
  // ach
  achRoutingNo?: string
  achAccountNo?: string
  achAccountType?: 'CHECKING' | 'SAVINGS'
  achEffectiveDate?: string
  // posting behavior
  postNow?: boolean // if true, immediately create JE and mark ISSUED
}

// ─── Create a payment (cheque or ACH) ──────────────────────────────────────────
export async function createPayment(input: CreatePaymentInput) {
  if (input.amount <= 0) throw new Error('Amount must be positive')

  const bank = await db.account.findFirst({
    where: { id: input.bankAccountId, entityId: input.entityId },
  })
  if (!bank) throw new Error('Bank account not found')
  if (!bank.isBankAccount) throw new Error('Selected account is not a bank account')

  return db.$transaction(async (tx) => {
    // Resolve cheque number / ACH metadata.
    let chequeNo = input.chequeNo
    let achBatchId: string | undefined
    let achTraceNo: string | undefined

    if (input.method === 'CHEQUE') {
      chequeNo = chequeNo || (await nextChequeNumber(input.entityId, input.bankAccountId, tx))
    } else {
      achBatchId = generateAchBatchId()
      achTraceNo = `${input.achRoutingNo?.slice(0, 8) ?? '00000000'}${Math.floor(Math.random() * 1e7)
        .toString()
        .padStart(7, '0')}`
    }

    const payment = await tx.payment.create({
      data: {
        entityId: input.entityId,
        bankAccountId: input.bankAccountId,
        method: input.method,
        status: 'DRAFT',
        payeeName: input.payeeName,
        payeeClientId: input.payeeClientId,
        amount: input.amount,
        paymentDate: new Date(input.paymentDate),
        memo: input.memo,
        expenseAccountId: input.expenseAccountId,
        apInvoiceId: input.apInvoiceId,
        createdBy: input.createdBy,
        chequeNo: input.method === 'CHEQUE' ? chequeNo : null,
        achRoutingNo: input.method === 'ACH' ? input.achRoutingNo : null,
        achAccountNo:
          input.method === 'ACH' && input.achAccountNo
            ? maskAccount(input.achAccountNo)
            : null,
        achAccountType: input.method === 'ACH' ? input.achAccountType : null,
        achTraceNo: achTraceNo ?? null,
        achBatchId: achBatchId ?? null,
        achEffectiveDate:
          input.method === 'ACH' && input.achEffectiveDate
            ? new Date(input.achEffectiveDate)
            : null,
      },
    })

    if (input.postNow) {
      await postPaymentToGl(payment.id, input.entityId, tx)
    }

    return tx.payment.findUnique({ where: { id: payment.id } })
  })
}

// Mask all but last 4 of an account number before persisting.
function maskAccount(acct: string): string {
  const digits = acct.replace(/\s/g, '')
  if (digits.length <= 4) return digits
  return `****${digits.slice(-4)}`
}

// ─── Post a payment to the general ledger ──────────────────────────────────────
// DR offset (expense/AP) ; CR bank. Marks payment ISSUED and links the JE.
export async function postPaymentToGl(paymentId: string, entityId: string, tx: Tx = db) {
  const payment = await tx.payment.findFirst({ where: { id: paymentId, entityId } })
  if (!payment) throw new Error('Payment not found')
  if (payment.status !== 'DRAFT') throw new Error(`Cannot post a ${payment.status} payment`)
  if (!payment.expenseAccountId) throw new Error('expenseAccountId required to post')

  await assertDateUnlocked(entityId, payment.paymentDate)

  const count = await tx.journalEntry.count({ where: { entityId } })
  const prefix = payment.method === 'CHEQUE' ? 'CHK' : 'ACH'
  const ref = `${prefix}-${new Date().getFullYear()}-${String(count + 1).padStart(4, '0')}`

  const desc =
    payment.method === 'CHEQUE'
      ? `Cheque #${payment.chequeNo} to ${payment.payeeName}`
      : `ACH to ${payment.payeeName} (${payment.achBatchId})`

  const entry = await tx.journalEntry.create({
    data: {
      entityId,
      ref,
      date: payment.paymentDate,
      description: desc,
      memo: payment.memo,
      status: 'POSTED',
      source: payment.method,
      postedAt: new Date(),
      createdBy: payment.createdBy,
      lines: {
        create: [
          {
            accountId: payment.expenseAccountId,
            description: payment.payeeName,
            debit: payment.amount,
            credit: 0,
            lineOrder: 0,
          },
          {
            accountId: payment.bankAccountId,
            description: desc,
            debit: 0,
            credit: payment.amount,
            lineOrder: 1,
          },
        ],
      },
    },
  })

  await tx.payment.update({
    where: { id: paymentId },
    data: { status: 'ISSUED', journalEntryId: entry.id },
  })

  // If tied to an AP invoice, record the payment + update its balance.
  if (payment.apInvoiceId) {
    const inv = await tx.apInvoice.findUnique({ where: { id: payment.apInvoiceId } })
    if (inv) {
      const newPaidCents = toCents(inv.amountPaid) + toCents(payment.amount)
      const balanceCents = toCents(inv.amount) - newPaidCents
      await tx.apPayment.create({
        data: {
          invoiceId: inv.id,
          amount: payment.amount,
          paidOn: payment.paymentDate,
          method: payment.method,
          reference: payment.method === 'CHEQUE' ? payment.chequeNo : payment.achTraceNo,
        },
      })
      await tx.apInvoice.update({
        where: { id: inv.id },
        data: {
          amountPaid: newPaidCents / 100,
          status: balanceCents <= 0 ? 'PAID' : 'PARTIALLY_PAID',
          paidAt: balanceCents <= 0 ? new Date() : null,
        },
      })
    }
  }

  await tx.auditLog.create({
    data: {
      entityId,
      userId: payment.createdBy,
      action: payment.method === 'CHEQUE' ? 'CHEQUE_ISSUED' : 'ACH_ISSUED',
      resource: 'Payment',
      resourceId: paymentId,
      newValue: JSON.stringify({ ref, amount: Number(payment.amount) }),
    },
  })

  return entry
}

// ─── Void a payment ────────────────────────────────────────────────────────────
// Reverses the GL entry (mirror JE) rather than deleting, preserving the trail.
export async function voidPayment(
  paymentId: string,
  entityId: string,
  reason: string,
  userId?: string
) {
  return db.$transaction(async (tx) => {
    const payment = await tx.payment.findFirst({ where: { id: paymentId, entityId } })
    if (!payment) throw new Error('Payment not found')
    if (payment.status === 'VOID') throw new Error('Already void')
    if (payment.status === 'CLEARED') throw new Error('Cannot void a cleared payment')

    // Reversing entry is dated NOW — block if today is in a locked period.
    await assertDateUnlocked(entityId, new Date())

    if (payment.journalEntryId) {
      const orig = await tx.journalEntry.findUnique({
        where: { id: payment.journalEntryId },
        include: { lines: true },
      })
      if (orig && orig.status === 'POSTED') {
        const count = await tx.journalEntry.count({ where: { entityId } })
        await tx.journalEntry.create({
          data: {
            entityId,
            ref: `REV-${new Date().getFullYear()}-${String(count + 1).padStart(4, '0')}`,
            date: new Date(),
            description: `VOID: ${orig.description} — ${reason}`,
            status: 'POSTED',
            source: 'VOID',
            postedAt: new Date(),
            createdBy: userId,
            lines: {
              create: orig.lines.map((l, i) => ({
                accountId: l.accountId,
                description: `Reversal: ${l.description ?? ''}`,
                debit: l.credit, // swap to reverse
                credit: l.debit,
                lineOrder: i,
              })),
            },
          },
        })
        await tx.journalEntry.update({ where: { id: orig.id }, data: { status: 'VOID' } })
      }
    }

    const voided = await tx.payment.update({
      where: { id: paymentId },
      data: { status: 'VOID', voidedAt: new Date(), voidReason: reason },
    })

    await tx.auditLog.create({
      data: {
        entityId,
        userId,
        action: 'PAYMENT_VOIDED',
        resource: 'Payment',
        resourceId: paymentId,
        newValue: JSON.stringify({ reason }),
      },
    })

    return voided
  })
}

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireEntityAccess } from '@/lib/auth'

const invoiceSchema = z.object({
  vendor: z.string().min(1),
  invoiceNo: z.string().min(1),
  invoiceDate: z.string(),
  dueDate: z.string(),
  amount: z.number().positive(),
  accountId: z.string().optional(),
  clientId: z.string().optional(),
  notes: z.string().optional(),
})

export async function GET(req: NextRequest) {
  const entityId = req.nextUrl.searchParams.get('entityId')
  if (!entityId) return NextResponse.json({ error: 'entityId required' }, { status: 400 })

  const auth = await requireEntityAccess(req, entityId, 'ap:read')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const status = req.nextUrl.searchParams.get('status')
  const today = new Date()

  const invoices = await db.apInvoice.findMany({
    where: {
      entityId,
      ...(status && status !== 'ALL' ? { status: status as never } : {}),
    },
    include: {
      payments: { orderBy: { paidOn: 'desc' } },
      account: { select: { code: true, name: true } },
      client: { select: { code: true, name: true } },
    },
    orderBy: { dueDate: 'asc' },
  })

  // Compute aging and update overdue status
  const enriched = invoices.map(inv => {
    const daysOverdue = Math.floor((today.getTime() - new Date(inv.dueDate).getTime()) / 86400000)
    const balance = Number(inv.amount) - Number(inv.amountPaid)

    let agingBucket = 'Current'
    if (daysOverdue > 0 && balance > 0) {
      if (daysOverdue <= 30) agingBucket = '1-30 days'
      else if (daysOverdue <= 60) agingBucket = '31-60 days'
      else if (daysOverdue <= 90) agingBucket = '61-90 days'
      else agingBucket = '90+ days'
    }

    return { ...inv, daysOverdue: Math.max(0, daysOverdue), balance, agingBucket }
  })

  // Summary
  const summary = {
    total: enriched.reduce((s, i) => s + i.balance, 0),
    current: enriched.filter(i => i.agingBucket === 'Current').reduce((s, i) => s + i.balance, 0),
    overdue30: enriched.filter(i => i.agingBucket === '1-30 days').reduce((s, i) => s + i.balance, 0),
    overdue60: enriched.filter(i => i.agingBucket === '31-60 days').reduce((s, i) => s + i.balance, 0),
    overdue90: enriched.filter(i => i.agingBucket === '61-90 days').reduce((s, i) => s + i.balance, 0),
    overdue90plus: enriched.filter(i => i.agingBucket === '90+ days').reduce((s, i) => s + i.balance, 0),
    count: enriched.length,
    overdueCount: enriched.filter(i => i.daysOverdue > 0 && i.balance > 0).length,
  }

  return NextResponse.json({ invoices: enriched, summary })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { entityId, ...invoiceData } = body

  if (!entityId) return NextResponse.json({ error: 'entityId required' }, { status: 400 })

  const auth = await requireEntityAccess(req, entityId, 'ap:write')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const data = invoiceSchema.parse(invoiceData)

    const invoice = await db.apInvoice.create({
      data: {
        entityId,
        vendor: data.vendor,
        invoiceNo: data.invoiceNo,
        invoiceDate: new Date(data.invoiceDate),
        dueDate: new Date(data.dueDate),
        amount: data.amount,
        accountId: data.accountId,
        clientId: data.clientId,
        notes: data.notes,
        status: 'PENDING',
      },
    })

    // Auto-create journal entry: DR Expense / CR Accounts Payable
    if (data.accountId) {
      const apAccount = await db.account.findFirst({
        where: { entityId, code: '2000' },
      })
      if (apAccount) {
        const count = await db.journalEntry.count({ where: { entityId } })
        await db.journalEntry.create({
          data: {
            entityId,
            ref: `AP-${new Date().getFullYear()}-${String(count + 1).padStart(4, '0')}`,
            date: new Date(data.invoiceDate),
            description: `AP Invoice: ${data.vendor} #${data.invoiceNo}`,
            status: 'POSTED',
            source: 'AP',
            postedAt: new Date(),
            lines: {
              create: [
                { accountId: data.accountId, debit: data.amount, credit: 0, lineOrder: 0 },
                { accountId: apAccount.id, debit: 0, credit: data.amount, lineOrder: 1 },
              ],
            },
          },
        })
      }
    }

    return NextResponse.json(invoice, { status: 201 })
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: e.errors }, { status: 400 })
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

// Record a payment against an AP invoice
export async function recordPayment(
  req: NextRequest,
  invoiceId: string,
  entityId: string
) {
  const auth = await requireEntityAccess(req, entityId, 'ap:write')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { amount, paidOn, method, reference } = await req.json()

  const invoice = await db.apInvoice.findFirst({ where: { id: invoiceId, entityId } })
  if (!invoice) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })

  const newAmountPaid = Number(invoice.amountPaid) + amount
  const balance = Number(invoice.amount) - newAmountPaid

  await db.$transaction(async (tx) => {
    await tx.apPayment.create({
      data: { invoiceId, amount, paidOn: new Date(paidOn), method, reference },
    })
    await tx.apInvoice.update({
      where: { id: invoiceId },
      data: {
        amountPaid: newAmountPaid,
        status: balance <= 0.005 ? 'PAID' : 'PARTIALLY_PAID',
        paidAt: balance <= 0.005 ? new Date() : null,
      },
    })
  })

  return NextResponse.json({ success: true })
}

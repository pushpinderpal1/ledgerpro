import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireEntityAccess } from '@/lib/auth'
import {
  createPayment,
  postPaymentToGl,
  voidPayment,
  nextChequeNumber,
} from '@/lib/payments'

const createSchema = z.object({
  entityId: z.string(),
  bankAccountId: z.string(),
  method: z.enum(['CHEQUE', 'ACH']),
  payeeName: z.string().min(1),
  payeeClientId: z.string().optional(),
  amount: z.number().positive(),
  paymentDate: z.string(),
  memo: z.string().optional(),
  expenseAccountId: z.string().optional(),
  apInvoiceId: z.string().optional(),
  postNow: z.boolean().optional(),
  // cheque
  chequeNo: z.string().optional(),
  // ach
  achRoutingNo: z.string().regex(/^\d{9}$/, '9-digit routing number').optional(),
  achAccountNo: z.string().optional(),
  achAccountType: z.enum(['CHECKING', 'SAVINGS']).optional(),
  achEffectiveDate: z.string().optional(),
})

// ─── GET /api/payments?entityId=&method=&status=&nextCheque=bankAccountId ──────
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const entityId = searchParams.get('entityId')
  if (!entityId) return NextResponse.json({ error: 'entityId required' }, { status: 400 })

  const auth = await requireEntityAccess(req, entityId, 'payments:read')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  // Helper: next cheque number for a bank account
  const nextChequeFor = searchParams.get('nextCheque')
  if (nextChequeFor) {
    const n = await nextChequeNumber(entityId, nextChequeFor)
    return NextResponse.json({ nextChequeNo: n })
  }

  const method = searchParams.get('method')
  const status = searchParams.get('status')

  const payments = await db.payment.findMany({
    where: {
      entityId,
      ...(method ? { method: method as never } : {}),
      ...(status ? { status: status as never } : {}),
    },
    include: { bankAccount: { select: { code: true, name: true } } },
    orderBy: { paymentDate: 'desc' },
  })

  return NextResponse.json({ payments })
}

// ─── POST /api/payments  (create cheque or ACH) ───────────────────────────────
export async function POST(req: NextRequest) {
  const body = await req.json()
  const auth = await requireEntityAccess(req, body.entityId, 'payments:write')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const data = createSchema.parse(body)
    if (data.method === 'ACH' && (!data.achRoutingNo || !data.achAccountNo)) {
      return NextResponse.json(
        { error: 'ACH requires routing number and account number' },
        { status: 400 }
      )
    }
    const payment = await createPayment({ ...data, createdBy: auth.session?.userId })
    return NextResponse.json(payment, { status: 201 })
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: e.errors }, { status: 400 })
    const msg = e instanceof Error ? e.message : 'Server error'
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}

// ─── PATCH /api/payments  (post | void) ───────────────────────────────────────
export async function PATCH(req: NextRequest) {
  const body = await req.json()
  const { entityId, paymentId, action, reason } = body
  if (!entityId || !paymentId || !action)
    return NextResponse.json({ error: 'entityId, paymentId, action required' }, { status: 400 })

  const auth = await requireEntityAccess(req, entityId, 'payments:write')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    if (action === 'post') {
      const entry = await postPaymentToGl(paymentId, entityId)
      return NextResponse.json({ success: true, journalEntryId: entry.id })
    }
    if (action === 'void') {
      const voided = await voidPayment(paymentId, entityId, reason || 'No reason given', auth.session?.userId)
      return NextResponse.json(voided)
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error'
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}

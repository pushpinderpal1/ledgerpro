import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireEntityAccess } from '@/lib/auth'
import { logAudit } from '@/lib/audit'

/**
 * /api/receipts
 *
 * Records incoming money. Each receipt creates a balanced journal entry
 * in a single transaction:
 *   DR <depositAccountId>  amount         (bank or cash account)
 *   CR <creditAccountId>   amount         (AR / Revenue account)
 *
 * Receipt numbers auto-generated as RCP-YYYY-NNNN within the entity.
 *
 *   GET    ?entityId=&status=                  → list
 *   GET    ?entityId=&id=                      → detail
 *   POST   { entityId, ... }                   → create + post
 *   PATCH  { entityId, id, action: 'void' }    → void (creates reversing JE)
 */

const createSchema = z.object({
  entityId:         z.string(),
  receivedFrom:     z.string().min(1).max(200),
  receiptDate:      z.string(),
  amount:           z.number().positive(),
  paymentModeId:    z.string(),
  reference:        z.string().max(120).optional(),
  description:      z.string().max(1000).optional(),
  depositAccountId: z.string(),
  creditAccountId:  z.string(),
})

const patchSchema = z.object({
  entityId: z.string(),
  id:       z.string(),
  action:   z.enum(['void']),
  voidDate: z.string().optional(),
})

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const entityId = sp.get('entityId')
  if (!entityId) return NextResponse.json({ error: 'entityId required' }, { status: 400 })

  const auth = await requireEntityAccess(req, entityId, 'receipts:read')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const id = sp.get('id')
  if (id) {
    const r = await db.receipt.findFirst({
      where: { id, entityId },
      include: {
        paymentMode:    { select: { id: true, name: true, code: true } },
        depositAccount: { select: { id: true, code: true, name: true } },
        creditAccount:  { select: { id: true, code: true, name: true } },
        journalEntry:   { select: { id: true, ref: true, date: true } },
        voidJournalEntry: { select: { id: true, ref: true, date: true } },
      },
    })
    if (!r) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json(r)
  }

  const status = sp.get('status')
  const receipts = await db.receipt.findMany({
    where: {
      entityId,
      ...(status && status !== 'ALL' ? { status: status as 'POSTED' | 'VOID' } : {}),
    },
    include: {
      paymentMode:    { select: { name: true, code: true } },
      depositAccount: { select: { code: true, name: true } },
      creditAccount:  { select: { code: true, name: true } },
      journalEntry:   { select: { ref: true } },
    },
    orderBy: [{ receiptDate: 'desc' }, { createdAt: 'desc' }],
    take: 500,
  })

  // Summary
  const postedTotal = receipts
    .filter(r => r.status === 'POSTED')
    .reduce((s, r) => s + Number(r.amount), 0)

  return NextResponse.json({
    receipts,
    summary: {
      total: postedTotal,
      countPosted: receipts.filter(r => r.status === 'POSTED').length,
      countVoid:   receipts.filter(r => r.status === 'VOID').length,
    },
  })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const auth = await requireEntityAccess(req, body.entityId, 'receipts:write')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const data = createSchema.parse(body)

    // Validate accounts and payment mode all belong to this entity.
    const [deposit, credit, mode] = await Promise.all([
      db.account.findFirst({ where: { id: data.depositAccountId, entityId: data.entityId } }),
      db.account.findFirst({ where: { id: data.creditAccountId,  entityId: data.entityId } }),
      db.paymentMode.findFirst({ where: { id: data.paymentModeId, entityId: data.entityId } }),
    ])
    if (!deposit) return NextResponse.json({ error: 'Deposit account not found' }, { status: 400 })
    if (!credit)  return NextResponse.json({ error: 'Credit account not found'  }, { status: 400 })
    if (!mode)    return NextResponse.json({ error: 'Payment mode not found'    }, { status: 400 })
    if (mode.kind === 'PAYMENT') return NextResponse.json({ error: `Mode "${mode.name}" is for outgoing payments only` }, { status: 400 })
    if (data.depositAccountId === data.creditAccountId) {
      return NextResponse.json({ error: 'Deposit and Credit accounts must be different' }, { status: 400 })
    }

    const result = await db.$transaction(async (tx) => {
      // Auto-numbering: RCP-YYYY-NNNN, scoped to entity + year
      const year = new Date(data.receiptDate).getFullYear()
      const existingThisYear = await tx.receipt.count({
        where: {
          entityId: data.entityId,
          receiptNo: { startsWith: `RCP-${year}-` },
        },
      })
      const receiptNo = `RCP-${year}-${String(existingThisYear + 1).padStart(4, '0')}`

      // Pre-create JE numbering
      const jeCount = await tx.journalEntry.count({ where: { entityId: data.entityId } })
      const jeRef = `RCP-${year}-${String(jeCount + 1).padStart(4, '0')}`

      const je = await tx.journalEntry.create({
        data: {
          entityId: data.entityId,
          ref: jeRef,
          date: new Date(data.receiptDate),
          description: `Receipt: ${data.receivedFrom} (${mode.name})`,
          status: 'POSTED',
          source: 'RECEIPT',
          postedAt: new Date(),
          createdBy: auth.session?.userId,
          lines: {
            create: [
              { accountId: data.depositAccountId, debit: data.amount, credit: 0, lineOrder: 0,
                description: `Receipt from ${data.receivedFrom}` },
              { accountId: data.creditAccountId, debit: 0, credit: data.amount, lineOrder: 1,
                description: data.description ?? `${mode.name}${data.reference ? ' #' + data.reference : ''}` },
            ],
          },
        },
      })

      const receipt = await tx.receipt.create({
        data: {
          entityId:         data.entityId,
          receiptNo,
          receivedFrom:     data.receivedFrom,
          receiptDate:      new Date(data.receiptDate),
          amount:           data.amount,
          paymentModeId:    data.paymentModeId,
          reference:        data.reference,
          description:      data.description,
          depositAccountId: data.depositAccountId,
          creditAccountId:  data.creditAccountId,
          status:           'POSTED',
          journalEntryId:   je.id,
          createdBy:        auth.session?.userId,
        },
      })

      return { receipt, je }
    })

    await logAudit({
      entityId: data.entityId, userId: auth.session?.userId,
      action: 'RECEIPT_CREATED', resource: 'Receipt', resourceId: result.receipt.id,
      after: { receiptNo: result.receipt.receiptNo, amount: data.amount, journalRef: result.je.ref },
      request: req,
    })

    return NextResponse.json({
      receipt: result.receipt,
      journalRef: result.je.ref,
    }, { status: 201 })
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: e.errors }, { status: 400 })
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = patchSchema.parse(await req.json())
    const auth = await requireEntityAccess(req, body.entityId, 'receipts:write')
    if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const receipt = await db.receipt.findFirst({ where: { id: body.id, entityId: body.entityId } })
    if (!receipt) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (receipt.status === 'VOID') return NextResponse.json({ error: 'Receipt is already void' }, { status: 400 })

    // Void by posting a reversing JE
    const voidDate = body.voidDate ? new Date(body.voidDate) : new Date()
    const result = await db.$transaction(async (tx) => {
      const jeCount = await tx.journalEntry.count({ where: { entityId: body.entityId } })
      const year = new Date().getFullYear()
      const voidJe = await tx.journalEntry.create({
        data: {
          entityId: body.entityId,
          ref: `RCPV-${year}-${String(jeCount + 1).padStart(4, '0')}`,
          date: voidDate,
          description: `VOID Receipt ${receipt.receiptNo}: ${receipt.receivedFrom}`,
          status: 'POSTED',
          source: 'RECEIPT',
          postedAt: new Date(),
          createdBy: auth.session?.userId,
          lines: {
            create: [
              // Reverse the original posting
              { accountId: receipt.creditAccountId,  debit: receipt.amount, credit: 0, lineOrder: 0,
                description: `VOID ${receipt.receiptNo}` },
              { accountId: receipt.depositAccountId, debit: 0, credit: receipt.amount, lineOrder: 1,
                description: `VOID ${receipt.receiptNo}` },
            ],
          },
        },
      })

      const updated = await tx.receipt.update({
        where: { id: body.id },
        data: {
          status: 'VOID',
          voidedAt: voidDate,
          voidedBy: auth.session?.userId,
          voidJournalEntryId: voidJe.id,
        },
      })
      return { updated, voidJe }
    })

    await logAudit({
      entityId: body.entityId, userId: auth.session?.userId,
      action: 'RECEIPT_VOIDED', resource: 'Receipt', resourceId: body.id,
      after: { voidJournalRef: result.voidJe.ref },
      request: req,
    })

    return NextResponse.json({ receipt: result.updated, voidJournalRef: result.voidJe.ref })
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: e.errors }, { status: 400 })
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

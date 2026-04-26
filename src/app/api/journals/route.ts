import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireEntityAccess } from '@/lib/auth'

const lineSchema = z.object({
  accountId: z.string(),
  description: z.string().optional(),
  debit: z.number().min(0).default(0),
  credit: z.number().min(0).default(0),
  lineOrder: z.number().default(0),
})

const entrySchema = z.object({
  date: z.string(),
  description: z.string().min(1),
  memo: z.string().optional(),
  lines: z.array(lineSchema).min(2),
})

// ─── GET /api/journals?entityId= ──────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const entityId = req.nextUrl.searchParams.get('entityId')
  if (!entityId) return NextResponse.json({ error: 'entityId required' }, { status: 400 })

  const auth = await requireEntityAccess(req, entityId, 'journals:read')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { searchParams } = req.nextUrl
  const page = parseInt(searchParams.get('page') ?? '1')
  const limit = parseInt(searchParams.get('limit') ?? '50')
  const status = searchParams.get('status')
  const from = searchParams.get('from')
  const to = searchParams.get('to')

  const where: Record<string, unknown> = { entityId }
  if (status) where.status = status
  if (from || to) {
    where.date = {}
    if (from) (where.date as Record<string, Date>).gte = new Date(from)
    if (to) (where.date as Record<string, Date>).lte = new Date(to)
  }

  const [entries, total] = await Promise.all([
    db.journalEntry.findMany({
      where,
      include: {
        lines: {
          include: { account: { select: { code: true, name: true } } },
          orderBy: { lineOrder: 'asc' },
        },
      },
      orderBy: { date: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.journalEntry.count({ where }),
  ])

  return NextResponse.json({ entries, total, page, pages: Math.ceil(total / limit) })
}

// ─── POST /api/journals ────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const body = await req.json()
  const { entityId, ...entryData } = body

  if (!entityId) return NextResponse.json({ error: 'entityId required' }, { status: 400 })

  const auth = await requireEntityAccess(req, entityId, 'journals:write')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const data = entrySchema.parse(entryData)

    // Validate double-entry balance
    const totalDebit  = data.lines.reduce((s, l) => s + l.debit, 0)
    const totalCredit = data.lines.reduce((s, l) => s + l.credit, 0)

    if (Math.abs(totalDebit - totalCredit) > 0.005) {
      return NextResponse.json({
        error: `Journal entry is unbalanced: Debits ${totalDebit.toFixed(2)} ≠ Credits ${totalCredit.toFixed(2)}`,
      }, { status: 400 })
    }

    // Generate reference number
    const count = await db.journalEntry.count({ where: { entityId } })
    const ref = `JE-${new Date().getFullYear()}-${String(count + 1).padStart(4, '0')}`

    const entry = await db.journalEntry.create({
      data: {
        entityId,
        ref,
        date: new Date(data.date),
        description: data.description,
        memo: data.memo,
        status: 'DRAFT',
        source: 'MANUAL',
        createdBy: auth.session?.userId,
        lines: {
          create: data.lines.map((l, i) => ({
            accountId: l.accountId,
            description: l.description,
            debit: l.debit,
            credit: l.credit,
            lineOrder: l.lineOrder || i,
          })),
        },
      },
      include: { lines: { include: { account: true } } },
    })

    return NextResponse.json(entry, { status: 201 })
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: e.errors }, { status: 400 })
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

// ─── PATCH /api/journals/[id]/post ────────────────────────────────────────────
export async function patchJournalStatus(
  req: NextRequest,
  entryId: string,
  entityId: string,
  action: 'post' | 'void'
) {
  const auth = await requireEntityAccess(req, entityId, 'journals:write')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const entry = await db.journalEntry.findFirst({ where: { id: entryId, entityId } })
  if (!entry) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (action === 'post' && entry.status !== 'DRAFT') {
    return NextResponse.json({ error: 'Can only post DRAFT entries' }, { status: 400 })
  }
  if (action === 'void' && entry.status === 'VOID') {
    return NextResponse.json({ error: 'Already voided' }, { status: 400 })
  }

  const updated = await db.journalEntry.update({
    where: { id: entryId },
    data: {
      status: action === 'post' ? 'POSTED' : 'VOID',
      postedAt: action === 'post' ? new Date() : null,
    },
  })

  await db.auditLog.create({
    data: {
      entityId, userId: auth.session?.userId,
      action: action === 'post' ? 'JOURNAL_POSTED' : 'JOURNAL_VOIDED',
      resource: 'JournalEntry', resourceId: entryId,
    },
  })

  return NextResponse.json(updated)
}

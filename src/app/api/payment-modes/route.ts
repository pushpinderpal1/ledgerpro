import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireEntityAccess } from '@/lib/auth'

/**
 * /api/payment-modes
 *
 * Configurable catalog of payment methods. Used by both AP Payments
 * (outgoing) and Receipts (incoming).
 *
 * On first read for an entity with zero rows, the API auto-seeds a sensible
 * default set so users don't start from an empty list. The defaults can
 * be edited or deactivated like any other row.
 *
 *   GET    ?entityId=&kind=          → list (filter by RECEIPT / PAYMENT / BOTH)
 *   POST   { entityId, name, code, kind }   → create
 *   PATCH  { id, entityId, ... }            → update
 *   DELETE ?id=&entityId=                   → delete (only if unused)
 */

const DEFAULT_MODES: Array<{ name: string; code: string; kind: 'PAYMENT'|'RECEIPT'|'BOTH'; sortOrder: number }> = [
  { name: 'Cheque',           code: 'CHEQUE',       kind: 'BOTH',    sortOrder: 10 },
  { name: 'Bank Transfer',    code: 'BANK_TRANSFER', kind: 'BOTH',    sortOrder: 20 },
  { name: 'ACH',              code: 'ACH',          kind: 'BOTH',    sortOrder: 30 },
  { name: 'Wire',             code: 'WIRE',         kind: 'BOTH',    sortOrder: 40 },
  { name: 'Credit Card',      code: 'CREDIT_CARD',  kind: 'RECEIPT', sortOrder: 50 },
  { name: 'Cash',             code: 'CASH',         kind: 'BOTH',    sortOrder: 60 },
  { name: 'Other',            code: 'OTHER',        kind: 'BOTH',    sortOrder: 999 },
]

async function ensureDefaults(entityId: string) {
  const count = await db.paymentMode.count({ where: { entityId } })
  if (count > 0) return
  await db.paymentMode.createMany({
    data: DEFAULT_MODES.map(m => ({ entityId, ...m })),
  })
}

const createSchema = z.object({
  entityId: z.string(),
  name: z.string().min(1).max(60),
  code: z.string().min(1).max(40).regex(/^[A-Z0-9_]+$/, 'Code must be uppercase letters, digits, or underscores'),
  kind: z.enum(['PAYMENT', 'RECEIPT', 'BOTH']).default('BOTH'),
  sortOrder: z.number().int().optional(),
})

const patchSchema = z.object({
  entityId: z.string(),
  id: z.string(),
  name: z.string().min(1).max(60).optional(),
  kind: z.enum(['PAYMENT', 'RECEIPT', 'BOTH']).optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
})

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const entityId = sp.get('entityId')
  if (!entityId) return NextResponse.json({ error: 'entityId required' }, { status: 400 })

  const auth = await requireEntityAccess(req, entityId, 'payment-modes:read')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  await ensureDefaults(entityId)

  const kindFilter = sp.get('kind') as 'PAYMENT'|'RECEIPT'|'BOTH'|null
  const modes = await db.paymentMode.findMany({
    where: {
      entityId,
      ...(kindFilter ? { OR: [{ kind: kindFilter }, { kind: 'BOTH' }] } : {}),
    },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  })
  return NextResponse.json({ modes })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const auth = await requireEntityAccess(req, body.entityId, 'payment-modes:write')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const data = createSchema.parse(body)
    const created = await db.paymentMode.create({ data })
    return NextResponse.json(created, { status: 201 })
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: e.errors }, { status: 400 })
    if ((e as { code?: string }).code === 'P2002') {
      return NextResponse.json({ error: 'A mode with that code already exists in this entity' }, { status: 409 })
    }
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = patchSchema.parse(await req.json())
    const auth = await requireEntityAccess(req, body.entityId, 'payment-modes:write')
    if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const updates: Record<string, unknown> = {}
    if (body.name !== undefined) updates.name = body.name
    if (body.kind !== undefined) updates.kind = body.kind
    if (body.isActive !== undefined) updates.isActive = body.isActive
    if (body.sortOrder !== undefined) updates.sortOrder = body.sortOrder

    const updated = await db.paymentMode.update({
      where: { id: body.id },
      data: updates,
    })
    return NextResponse.json(updated)
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: e.errors }, { status: 400 })
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
}

export async function DELETE(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const entityId = sp.get('entityId'); const id = sp.get('id')
  if (!entityId || !id) return NextResponse.json({ error: 'entityId, id required' }, { status: 400 })

  const auth = await requireEntityAccess(req, entityId, 'payment-modes:write')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  // Refuse delete if any receipts reference this mode
  const inUse = await db.receipt.count({ where: { paymentModeId: id } })
  if (inUse > 0) {
    return NextResponse.json({
      error: `Mode is in use by ${inUse} receipt${inUse === 1 ? '' : 's'}. Deactivate it instead of deleting.`,
    }, { status: 409 })
  }
  await db.paymentMode.delete({ where: { id } })
  return NextResponse.json({ deleted: true })
}

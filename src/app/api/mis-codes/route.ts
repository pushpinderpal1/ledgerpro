import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireEntityAccess } from '@/lib/auth'
import { logAudit } from '@/lib/audit'
import { MIS_SOFT_CODE_CAP } from '@/lib/mis/policy'

/**
 * /api/mis-codes
 *
 *   GET    ?entityId=  [&includeInactive=1]   → list codes for the entity
 *   POST   { entityId, code, department, description? }
 *   PATCH  { entityId, id, ...patch }          → updates department/description/isActive/displayOrder
 *   DELETE ?entityId=&id=                       → soft-delete (sets isActive=false) if used, hard-delete if unused
 *
 * Permissions:
 *   read  → assets-equivalent (anyone with reporting access)
 *   write → accounts:write (OWNER/ADMIN/ACCOUNTANT)
 */

const createSchema = z.object({
  entityId: z.string(),
  code: z.string().min(1).max(20).regex(/^[A-Za-z0-9_\-]+$/, 'Code may only contain letters, digits, _ and -'),
  department: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  displayOrder: z.number().int().optional(),
})

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const entityId = sp.get('entityId')
  if (!entityId) return NextResponse.json({ error: 'entityId required' }, { status: 400 })

  const auth = await requireEntityAccess(req, entityId, 'accounts:read')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const includeInactive = sp.get('includeInactive') === '1'
  const codes = await db.misCode.findMany({
    where: {
      entityId,
      ...(includeInactive ? {} : { isActive: true }),
    },
    orderBy: [{ displayOrder: 'asc' }, { code: 'asc' }],
    include: { _count: { select: { journalLines: true } } },
  })
  return NextResponse.json({ codes, softCap: MIS_SOFT_CODE_CAP })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const auth = await requireEntityAccess(req, body.entityId, 'accounts:write')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const data = createSchema.parse(body)
    const existingCount = await db.misCode.count({ where: { entityId: data.entityId, isActive: true } })
    const created = await db.misCode.create({
      data: {
        entityId: data.entityId,
        code: data.code.toUpperCase(),
        department: data.department,
        description: data.description,
        displayOrder: data.displayOrder ?? existingCount,
      },
    })
    await logAudit({
      entityId: data.entityId,
      userId: auth.session?.userId,
      action: 'MIS_CODE_CREATED',
      resource: 'MisCode',
      resourceId: created.id,
      after: { code: created.code, department: created.department },
      request: req,
    })
    return NextResponse.json({ ...created, softCapWarning: existingCount + 1 > MIS_SOFT_CODE_CAP }, { status: 201 })
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: e.errors }, { status: 400 })
    // Surface the unique-constraint violation cleanly.
    if ((e as { code?: string }).code === 'P2002') {
      return NextResponse.json({ error: 'A code with that value already exists for this entity' }, { status: 409 })
    }
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
}

const patchSchema = z.object({
  entityId: z.string(),
  id: z.string(),
  department: z.string().min(1).max(120).optional(),
  description: z.string().max(500).nullable().optional(),
  isActive: z.boolean().optional(),
  displayOrder: z.number().int().optional(),
})

export async function PATCH(req: NextRequest) {
  const body = await req.json()
  const auth = await requireEntityAccess(req, body.entityId, 'accounts:write')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const data = patchSchema.parse(body)
    const before = await db.misCode.findFirst({ where: { id: data.id, entityId: data.entityId } })
    if (!before) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const { entityId, id, ...patch } = data
    const updated = await db.misCode.update({ where: { id }, data: patch })

    await logAudit({
      entityId, userId: auth.session?.userId,
      action: 'MIS_CODE_UPDATED', resource: 'MisCode', resourceId: id,
      before, after: updated, request: req,
    })
    return NextResponse.json(updated)
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: e.errors }, { status: 400 })
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
}

export async function DELETE(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const entityId = sp.get('entityId')
  const id = sp.get('id')
  if (!entityId || !id) return NextResponse.json({ error: 'entityId, id required' }, { status: 400 })

  const auth = await requireEntityAccess(req, entityId, 'accounts:write')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const before = await db.misCode.findFirst({
    where: { id, entityId },
    include: { _count: { select: { journalLines: true } } },
  })
  if (!before) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Soft-delete if used in any journal line; hard-delete if completely unused.
  if (before._count.journalLines > 0) {
    await db.misCode.update({ where: { id }, data: { isActive: false } })
    await logAudit({
      entityId, userId: auth.session?.userId,
      action: 'MIS_CODE_DEACTIVATED', resource: 'MisCode', resourceId: id,
      before, request: req,
    })
    return NextResponse.json({ softDeleted: true, reason: `Used by ${before._count.journalLines} journal line(s)` })
  }
  await db.misCode.delete({ where: { id } })
  await logAudit({
    entityId, userId: auth.session?.userId,
    action: 'MIS_CODE_DELETED', resource: 'MisCode', resourceId: id,
    before, request: req,
  })
  return NextResponse.json({ deleted: true })
}

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireEntityAccess } from '@/lib/auth'
import { logAudit } from '@/lib/audit'

const createSchema = z.object({
  entityId: z.string(),
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  depreciationMethod: z.enum(['STRAIGHT_LINE', 'DECLINING_BALANCE']),
  usefulLifeMonths: z.number().int().positive(),
  depreciationRatePercent: z.number().nonnegative(),
  assetAccountId: z.string(),
  accumDepAccountId: z.string(),
  depExpenseAccountId: z.string(),
})

export async function GET(req: NextRequest) {
  const entityId = req.nextUrl.searchParams.get('entityId')
  if (!entityId) return NextResponse.json({ error: 'entityId required' }, { status: 400 })

  const auth = await requireEntityAccess(req, entityId, 'assets:read')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const categories = await db.assetCategory.findMany({
    where: { entityId },
    include: {
      assetAccount:      { select: { code: true, name: true } },
      accumDepAccount:   { select: { code: true, name: true } },
      depExpenseAccount: { select: { code: true, name: true } },
      _count: { select: { assets: true } },
    },
    orderBy: { name: 'asc' },
  })
  return NextResponse.json({ categories })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const auth = await requireEntityAccess(req, body.entityId, 'assets:write')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const data = createSchema.parse(body)
    const created = await db.assetCategory.create({ data })
    await logAudit({
      entityId: data.entityId,
      userId: auth.session?.userId,
      action: 'ASSET_CATEGORY_CREATED',
      resource: 'AssetCategory',
      resourceId: created.id,
      after: { name: data.name, method: data.depreciationMethod, rate: data.depreciationRatePercent },
      request: req,
    })
    return NextResponse.json(created, { status: 201 })
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: e.errors }, { status: 400 })
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
}

export async function PATCH(req: NextRequest) {
  const body = await req.json()
  const { entityId, id, ...patch } = body
  if (!entityId || !id) return NextResponse.json({ error: 'entityId, id required' }, { status: 400 })

  const auth = await requireEntityAccess(req, entityId, 'assets:write')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const before = await db.assetCategory.findFirst({ where: { id, entityId } })
    if (!before) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const updated = await db.assetCategory.update({ where: { id }, data: patch })
    await logAudit({
      entityId, userId: auth.session?.userId,
      action: 'ASSET_CATEGORY_UPDATED', resource: 'AssetCategory', resourceId: id,
      before, after: updated, request: req,
    })
    return NextResponse.json(updated)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const entityId = searchParams.get('entityId')
  const id = searchParams.get('id')
  if (!entityId || !id) return NextResponse.json({ error: 'entityId, id required' }, { status: 400 })

  const auth = await requireEntityAccess(req, entityId, 'assets:write')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const used = await db.fixedAsset.count({ where: { categoryId: id } })
  if (used > 0) {
    return NextResponse.json({ error: `Cannot delete — ${used} asset${used === 1 ? '' : 's'} use${used === 1 ? 's' : ''} this category` }, { status: 409 })
  }
  const before = await db.assetCategory.findFirst({ where: { id, entityId } })
  if (!before) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  await db.assetCategory.delete({ where: { id } })
  await logAudit({
    entityId, userId: auth.session?.userId,
    action: 'ASSET_CATEGORY_DELETED', resource: 'AssetCategory', resourceId: id,
    before, request: req,
  })
  return NextResponse.json({ deleted: true })
}

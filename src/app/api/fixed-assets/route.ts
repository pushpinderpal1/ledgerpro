import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireEntityAccess } from '@/lib/auth'
import { logAudit } from '@/lib/audit'
import { runDepreciation, disposeAsset, endOfMonth } from '@/lib/assets'

const createSchema = z.object({
  entityId: z.string(),
  categoryId: z.string(),
  assetNo: z.string().min(1).max(50),
  description: z.string().min(1).max(255),
  acquisitionDate: z.string(),
  cost: z.number().nonnegative(),
  salvageValue: z.number().nonnegative().optional(),
  usefulLifeMonths: z.number().int().positive().optional(),
  depreciationMethod: z.enum(['STRAIGHT_LINE', 'DECLINING_BALANCE']).optional(),
  depreciationRatePercent: z.number().nonnegative().optional(),
  location: z.string().optional(),
  serialNumber: z.string().optional(),
  notes: z.string().optional(),
})

// ─── GET /api/fixed-assets ────────────────────────────────────────────────────
//   ?entityId= → list
//   ?entityId=&id= → one asset with full schedule
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const entityId = sp.get('entityId')
  if (!entityId) return NextResponse.json({ error: 'entityId required' }, { status: 400 })

  const auth = await requireEntityAccess(req, entityId, 'assets:read')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const id = sp.get('id')
  if (id) {
    const asset = await db.fixedAsset.findFirst({
      where: { id, entityId },
      include: {
        category: { include: {
          assetAccount: { select: { code: true, name: true } },
          accumDepAccount: { select: { code: true, name: true } },
          depExpenseAccount: { select: { code: true, name: true } },
        } },
        depreciationEntries: { orderBy: { periodEnd: 'asc' } },
      },
    })
    if (!asset) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const accumulated = asset.depreciationEntries.reduce((s, e) => s + Number(e.amount), 0)
    return NextResponse.json({
      asset,
      accumulated,
      bookValue: Number(asset.cost) - accumulated,
    })
  }

  const status = sp.get('status')
  const assets = await db.fixedAsset.findMany({
    where: { entityId, ...(status ? { status: status as never } : {}) },
    include: {
      category: { select: { id: true, name: true } },
      depreciationEntries: { select: { amount: true } },
    },
    orderBy: [{ status: 'asc' }, { assetNo: 'asc' }],
  })
  const rows = assets.map((a) => {
    const accumulated = a.depreciationEntries.reduce((s, e) => s + Number(e.amount), 0)
    return {
      ...a,
      depreciationEntries: undefined,
      accumulated,
      bookValue: Number(a.cost) - accumulated,
    }
  })
  return NextResponse.json({ assets: rows })
}

// ─── POST /api/fixed-assets  (create one asset) ───────────────────────────────
export async function POST(req: NextRequest) {
  const body = await req.json()
  const auth = await requireEntityAccess(req, body.entityId, 'assets:write')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const data = createSchema.parse(body)
    const category = await db.assetCategory.findFirst({ where: { id: data.categoryId, entityId: data.entityId } })
    if (!category) return NextResponse.json({ error: 'Category not found' }, { status: 404 })

    const created = await db.fixedAsset.create({
      data: {
        entityId: data.entityId,
        categoryId: data.categoryId,
        assetNo: data.assetNo,
        description: data.description,
        acquisitionDate: new Date(data.acquisitionDate),
        cost: data.cost,
        salvageValue: data.salvageValue ?? 0,
        usefulLifeMonths: data.usefulLifeMonths ?? category.usefulLifeMonths,
        depreciationMethod: data.depreciationMethod ?? category.depreciationMethod,
        depreciationRatePercent: data.depreciationRatePercent ?? Number(category.depreciationRatePercent),
        location: data.location,
        serialNumber: data.serialNumber,
        notes: data.notes,
      },
    })
    await logAudit({
      entityId: data.entityId, userId: auth.session?.userId,
      action: 'FIXED_ASSET_CREATED', resource: 'FixedAsset', resourceId: created.id,
      after: { assetNo: data.assetNo, description: data.description, cost: data.cost },
      request: req,
    })
    return NextResponse.json(created, { status: 201 })
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: e.errors }, { status: 400 })
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
}

// ─── PATCH /api/fixed-assets ──────────────────────────────────────────────────
//   action = "depreciate"  body: { entityId, periodEnd, catchUp?: boolean }
//   action = "dispose"     body: { entityId, assetId, disposalDate, proceeds,
//                                  proceedsAccountId, gainLossAccountId }
//   action = "edit"        body: { entityId, id, ...patch }
export async function PATCH(req: NextRequest) {
  const body = await req.json()
  const { entityId, action } = body
  if (!entityId || !action) return NextResponse.json({ error: 'entityId, action required' }, { status: 400 })

  const auth = await requireEntityAccess(req, entityId, 'assets:write')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    if (action === 'depreciate') {
      const periodEnd = endOfMonth(new Date(body.periodEnd))
      const result = await runDepreciation({
        entityId,
        periodEnd,
        catchUp: !!body.catchUp,
        userId: auth.session?.userId,
      })
      if (result.assetsProcessed > 0) {
        await logAudit({
          entityId, userId: auth.session?.userId,
          action: 'DEPRECIATION_POSTED', resource: 'JournalEntry', resourceId: result.journalEntryId,
          after: { periodEnd: periodEnd.toISOString().slice(0, 10), assetsProcessed: result.assetsProcessed, total: result.totalDepreciation },
          request: req,
        })
      }
      return NextResponse.json(result)
    }
    if (action === 'dispose') {
      const result = await disposeAsset({
        entityId,
        assetId: body.assetId,
        disposalDate: new Date(body.disposalDate),
        proceeds: Number(body.proceeds || 0),
        proceedsAccountId: body.proceedsAccountId,
        gainLossAccountId: body.gainLossAccountId,
        userId: auth.session?.userId,
      })
      await logAudit({
        entityId, userId: auth.session?.userId,
        action: 'ASSET_DISPOSED', resource: 'FixedAsset', resourceId: body.assetId,
        after: { proceeds: result.proceeds, bookValueAtDisposal: result.bookValueAtDisposal, gainOrLoss: result.gainOrLoss },
        request: req,
      })
      return NextResponse.json(result)
    }
    if (action === 'edit') {
      const { id, ...patch } = body
      if (!id) return NextResponse.json({ error: 'id required for edit' }, { status: 400 })
      const before = await db.fixedAsset.findFirst({ where: { id, entityId } })
      if (!before) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      // Restrict editable fields after acquisition
      const editable: Record<string, unknown> = {}
      const allowed = ['description', 'location', 'serialNumber', 'notes']
      for (const k of allowed) if (k in patch) editable[k] = patch[k]
      const updated = await db.fixedAsset.update({ where: { id }, data: editable })
      await logAudit({
        entityId, userId: auth.session?.userId,
        action: 'FIXED_ASSET_UPDATED', resource: 'FixedAsset', resourceId: id,
        before, after: updated, request: req,
      })
      return NextResponse.json(updated)
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
}

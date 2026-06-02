import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireEntityAccess } from '@/lib/auth'
import { logAudit } from '@/lib/audit'
import { computeInternalBalance, listVendors } from '@/lib/vendor-recon'

/**
 * /api/vendor-recon
 *
 *   GET  ?entityId=&vendors=1                              → list of vendor names from AP
 *   GET  ?entityId=                                        → list of reconciliations
 *   GET  ?entityId=&id=                                    → one reconciliation
 *   GET  ?entityId=&preview=1&vendor=&statementDate=       → preview the internal balance
 *   POST { entityId, vendor, statementDate, statementBalance, notes? }
 *   PATCH { entityId, id, action: 'finalize' | 'edit' | 'reopen', ... }
 *   DELETE ?entityId=&id=                                  → only allowed if DRAFT
 */

const createSchema = z.object({
  entityId: z.string(),
  vendor: z.string().min(1),
  statementDate: z.string(),
  statementBalance: z.number(),
  notes: z.string().max(2000).optional(),
})

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const entityId = sp.get('entityId')
  if (!entityId) return NextResponse.json({ error: 'entityId required' }, { status: 400 })

  const auth = await requireEntityAccess(req, entityId, 'recon:read')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  if (sp.get('vendors') === '1') {
    const vendors = await listVendors(entityId)
    return NextResponse.json({ vendors })
  }

  if (sp.get('preview') === '1') {
    const vendor = sp.get('vendor') ?? ''
    const dateStr = sp.get('statementDate')
    if (!vendor || !dateStr) return NextResponse.json({ error: 'vendor + statementDate required' }, { status: 400 })
    const internal = await computeInternalBalance(entityId, vendor, new Date(dateStr))
    return NextResponse.json({ internalBalance: internal })
  }

  const id = sp.get('id')
  if (id) {
    const rec = await db.vendorReconciliation.findFirst({ where: { id, entityId } })
    if (!rec) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    // For DRAFT reconciliations, recompute internalBalance live so the user
    // sees up-to-date numbers if AP changed since the recon was created.
    if (rec.status === 'DRAFT') {
      const internal = await computeInternalBalance(entityId, rec.vendor, rec.statementDate)
      return NextResponse.json({
        ...rec,
        internalBalanceLive: internal,
        differenceLive: Number(rec.statementBalance) - internal,
      })
    }
    return NextResponse.json(rec)
  }

  const recons = await db.vendorReconciliation.findMany({
    where: { entityId },
    orderBy: [{ statementDate: 'desc' }, { createdAt: 'desc' }],
    take: 200,
  })
  return NextResponse.json({ reconciliations: recons })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const auth = await requireEntityAccess(req, body.entityId, 'recon:write')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const data = createSchema.parse(body)
    const statementDate = new Date(data.statementDate)
    const internal = await computeInternalBalance(data.entityId, data.vendor, statementDate)
    const diff = data.statementBalance - internal

    const created = await db.vendorReconciliation.create({
      data: {
        entityId: data.entityId,
        vendor: data.vendor,
        statementDate,
        statementBalance: data.statementBalance,
        internalBalance: internal,
        difference: diff,
        status: 'DRAFT',
        notes: data.notes,
        createdBy: auth.session?.userId,
      },
    })
    await logAudit({
      entityId: data.entityId, userId: auth.session?.userId,
      action: 'VENDOR_RECON_CREATED', resource: 'VendorReconciliation', resourceId: created.id,
      after: { vendor: data.vendor, statementBalance: data.statementBalance, internalBalance: internal, difference: diff },
      request: req,
    })
    return NextResponse.json(created, { status: 201 })
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: e.errors }, { status: 400 })
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
}

const patchSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('finalize'),
    entityId: z.string(),
    id: z.string(),
    notes: z.string().max(2000).optional(),
  }),
  z.object({
    action: z.literal('edit'),
    entityId: z.string(),
    id: z.string(),
    statementBalance: z.number().optional(),
    notes: z.string().max(2000).nullable().optional(),
  }),
  z.object({
    action: z.literal('reopen'),
    entityId: z.string(),
    id: z.string(),
  }),
])

export async function PATCH(req: NextRequest) {
  try {
    const body = patchSchema.parse(await req.json())
    const auth = await requireEntityAccess(req, body.entityId, 'recon:write')
    if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const before = await db.vendorReconciliation.findFirst({ where: { id: body.id, entityId: body.entityId } })
    if (!before) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    if (body.action === 'finalize') {
      if (before.status === 'FINALIZED') return NextResponse.json({ error: 'Already finalized' }, { status: 400 })
      // Re-compute internal balance at the moment of finalize for accuracy.
      const internal = await computeInternalBalance(before.entityId, before.vendor, before.statementDate)
      const diff = Number(before.statementBalance) - internal
      const updated = await db.vendorReconciliation.update({
        where: { id: body.id },
        data: {
          internalBalance: internal,
          difference: diff,
          status: 'FINALIZED',
          finalizedAt: new Date(),
          finalizedBy: auth.session?.userId,
          notes: body.notes ?? before.notes,
        },
      })
      await logAudit({
        entityId: body.entityId, userId: auth.session?.userId,
        action: 'VENDOR_RECON_FINALIZED', resource: 'VendorReconciliation', resourceId: body.id,
        before, after: { internalBalance: internal, difference: diff }, request: req,
      })
      return NextResponse.json(updated)
    }

    if (body.action === 'edit') {
      if (before.status === 'FINALIZED') return NextResponse.json({ error: 'Cannot edit a finalized reconciliation — reopen first' }, { status: 409 })
      const updates: Record<string, unknown> = {}
      if (body.statementBalance !== undefined) {
        updates.statementBalance = body.statementBalance
        const internal = await computeInternalBalance(before.entityId, before.vendor, before.statementDate)
        updates.internalBalance = internal
        updates.difference = body.statementBalance - internal
      }
      if (body.notes !== undefined) updates.notes = body.notes
      const updated = await db.vendorReconciliation.update({ where: { id: body.id }, data: updates })
      await logAudit({
        entityId: body.entityId, userId: auth.session?.userId,
        action: 'VENDOR_RECON_UPDATED', resource: 'VendorReconciliation', resourceId: body.id,
        before, after: updates, request: req,
      })
      return NextResponse.json(updated)
    }

    // reopen
    if (before.status !== 'FINALIZED') return NextResponse.json({ error: 'Only finalized reconciliations can be reopened' }, { status: 400 })
    const updated = await db.vendorReconciliation.update({
      where: { id: body.id },
      data: { status: 'DRAFT', finalizedAt: null, finalizedBy: null },
    })
    await logAudit({
      entityId: body.entityId, userId: auth.session?.userId,
      action: 'VENDOR_RECON_REOPENED', resource: 'VendorReconciliation', resourceId: body.id,
      before, request: req,
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
  const auth = await requireEntityAccess(req, entityId, 'recon:write')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const before = await db.vendorReconciliation.findFirst({ where: { id, entityId } })
  if (!before) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (before.status === 'FINALIZED') {
    return NextResponse.json({ error: 'Cannot delete a finalized reconciliation — reopen and edit instead' }, { status: 409 })
  }
  await db.vendorReconciliation.delete({ where: { id } })
  await logAudit({
    entityId, userId: auth.session?.userId,
    action: 'VENDOR_RECON_DELETED', resource: 'VendorReconciliation', resourceId: id,
    before, request: req,
  })
  return NextResponse.json({ deleted: true })
}

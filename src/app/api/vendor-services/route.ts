import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireEntityAccess } from '@/lib/auth'
import { ALL_FREQUENCIES } from '@/lib/vendor/state'

/**
 * /api/vendor-services
 *
 *   GET    ?vendorId=&entityId=          → list services for a vendor
 *   POST   { entityId, vendorId, ... }   → add a service
 *   PATCH  { entityId, id, ... }         → update a service
 *   DELETE ?entityId=&id=                → remove a service
 *
 * `entityId` is passed on every request so we can authorize using the same
 * tenant guard as vendors.
 */

const frequencyEnum = z.enum(ALL_FREQUENCIES)

const createSchema = z.object({
  entityId:         z.string(),
  vendorId:         z.string(),
  serviceName:      z.string().min(1).max(200),
  frequency:        frequencyEnum,
  defaultAccountId: z.string().nullable().optional(),
  estimatedAmount:  z.union([z.number(), z.string(), z.null()]).optional(),
  notes:            z.string().max(1000).optional(),
})

const patchSchema = z.object({
  entityId:         z.string(),
  id:               z.string(),
  serviceName:      z.string().min(1).max(200).optional(),
  frequency:        frequencyEnum.optional(),
  defaultAccountId: z.string().nullable().optional(),
  estimatedAmount:  z.union([z.number(), z.string(), z.null()]).optional(),
  notes:            z.string().max(1000).nullable().optional(),
  isActive:         z.boolean().optional(),
})

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const entityId = sp.get('entityId')
  const vendorId = sp.get('vendorId')
  if (!entityId || !vendorId) return NextResponse.json({ error: 'entityId, vendorId required' }, { status: 400 })

  const auth = await requireEntityAccess(req, entityId, 'vendors:read')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  // Confirm vendor belongs to this entity
  const v = await db.vendor.findFirst({ where: { id: vendorId, entityId }, select: { id: true } })
  if (!v) return NextResponse.json({ error: 'Vendor not found' }, { status: 404 })

  const services = await db.vendorService.findMany({
    where: { vendorId },
    orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }],
    include: { defaultAccount: { select: { code: true, name: true } } },
  })
  return NextResponse.json(services.map(s => ({
    ...s,
    estimatedAmount: s.estimatedAmount != null ? Number(s.estimatedAmount) : null,
  })))
}

export async function POST(req: NextRequest) {
  try {
    const body = createSchema.parse(await req.json())
    const auth = await requireEntityAccess(req, body.entityId, 'vendors:write')
    if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

    // Ensure vendor belongs to entity
    const v = await db.vendor.findFirst({ where: { id: body.vendorId, entityId: body.entityId }, select: { id: true } })
    if (!v) return NextResponse.json({ error: 'Vendor not found in this entity' }, { status: 404 })

    if (body.defaultAccountId) {
      const ok = await db.account.findFirst({ where: { id: body.defaultAccountId, entityId: body.entityId } })
      if (!ok) return NextResponse.json({ error: 'Default account not found in this entity' }, { status: 400 })
    }

    const created = await db.vendorService.create({
      data: {
        vendorId:         body.vendorId,
        serviceName:      body.serviceName,
        frequency:        body.frequency,
        defaultAccountId: body.defaultAccountId ?? null,
        estimatedAmount:  body.estimatedAmount != null && body.estimatedAmount !== '' ? Number(body.estimatedAmount) : null,
        notes:            body.notes,
      },
    })
    return NextResponse.json({
      ...created,
      estimatedAmount: created.estimatedAmount != null ? Number(created.estimatedAmount) : null,
    }, { status: 201 })
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: e.errors }, { status: 400 })
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = patchSchema.parse(await req.json())
    const auth = await requireEntityAccess(req, body.entityId, 'vendors:write')
    if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const existing = await db.vendorService.findFirst({
      where: { id: body.id, vendor: { entityId: body.entityId } },
    })
    if (!existing) return NextResponse.json({ error: 'Service not found' }, { status: 404 })

    const updates: Record<string, unknown> = {}
    if (body.serviceName      !== undefined) updates.serviceName = body.serviceName
    if (body.frequency        !== undefined) updates.frequency = body.frequency
    if (body.defaultAccountId !== undefined) updates.defaultAccountId = body.defaultAccountId
    if (body.notes            !== undefined) updates.notes = body.notes
    if (body.isActive         !== undefined) updates.isActive = body.isActive
    if (body.estimatedAmount  !== undefined) {
      updates.estimatedAmount = body.estimatedAmount === null || body.estimatedAmount === ''
        ? null : Number(body.estimatedAmount)
    }

    const updated = await db.vendorService.update({ where: { id: body.id }, data: updates })
    return NextResponse.json({
      ...updated,
      estimatedAmount: updated.estimatedAmount != null ? Number(updated.estimatedAmount) : null,
    })
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: e.errors }, { status: 400 })
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
}

export async function DELETE(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const entityId = sp.get('entityId'); const id = sp.get('id')
  if (!entityId || !id) return NextResponse.json({ error: 'entityId, id required' }, { status: 400 })

  const auth = await requireEntityAccess(req, entityId, 'vendors:write')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const existing = await db.vendorService.findFirst({
    where: { id, vendor: { entityId } },
  })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await db.vendorService.delete({ where: { id } })
  return NextResponse.json({ deleted: true })
}

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireEntityAccess } from '@/lib/auth'
import { logAudit } from '@/lib/audit'
import { applyTransition, type VendorStatus, type VendorAction } from '@/lib/vendor/state'

/**
 * /api/vendors
 *
 *   GET    ?entityId=&status=&q=             → list with optional filters
 *   GET    ?entityId=&id=                    → detail (includes services + attachments meta)
 *   POST   { entityId, ...vendor fields }    → create (status: PENDING_APPROVAL)
 *   PATCH  { entityId, id, ...fields }       → edit (only PENDING/REJECTED freely; APPROVED logged)
 *   DELETE ?entityId=&id=                    → archive (INACTIVE) when in use, hard delete when unused
 *
 * /api/vendors  with body { action: 'workflow' }    → state transitions
 *   { entityId, id, transition: 'approve'|'reject'|'resubmit'|'archive'|'reactivate', reason? }
 *
 * Permissions:
 *   read    → AUDITOR+
 *   write   → AP_CLERK+    (create, edit fields)
 *   approve → ACCOUNTANT+  (approve / reject / archive / reactivate)
 */

const vendorFields = {
  vendorNumber:     z.string().max(40).optional(),
  legalName:        z.string().min(1).max(200),
  displayName:      z.string().max(120).optional(),
  contactPerson:    z.string().max(120).optional(),
  email:            z.string().email().or(z.literal('')).optional(),
  phone:            z.string().max(40).optional(),
  website:          z.string().max(200).optional(),
  addressLine1:     z.string().max(200).optional(),
  addressLine2:     z.string().max(200).optional(),
  city:             z.string().max(80).optional(),
  state:            z.string().max(80).optional(),
  postalCode:       z.string().max(20).optional(),
  country:          z.string().max(80).optional(),
  taxId:            z.string().max(40).optional(),
  taxIdType:        z.string().max(20).optional(),
  is1099Vendor:     z.boolean().optional(),
  taxResidency:     z.string().max(80).optional(),
  paymentTerms:     z.string().max(40).optional(),
  currency:         z.string().length(3).optional(),
  creditLimit:      z.union([z.number(), z.string(), z.null()]).optional(),
  defaultAccountId: z.string().nullable().optional(),
  bankName:         z.string().max(120).optional(),
  bankAccountName:  z.string().max(120).optional(),
  bankAccountNumber: z.string().max(40).optional(),
  bankRoutingNumber: z.string().max(40).optional(),
  bankSwiftBic:     z.string().max(20).optional(),
  bankIban:         z.string().max(40).optional(),
  notes:            z.string().max(2000).optional(),
}

const createSchema = z.object({ entityId: z.string(), ...vendorFields })
const patchSchema = z.object({
  entityId: z.string(),
  id: z.string(),
  ...Object.fromEntries(Object.entries(vendorFields).map(([k, v]) =>
    [k, k === 'legalName' ? v.optional() : v])) as typeof vendorFields,
})
const workflowSchema = z.object({
  entityId: z.string(),
  id: z.string(),
  transition: z.enum(['approve', 'reject', 'resubmit', 'archive', 'reactivate']),
  reason: z.string().max(500).optional(),
})

// Helper: strip empty strings to undefined so they don't override DB nulls with ''
function cleanFields<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (v === '' || v === undefined) continue
    out[k] = v
  }
  return out as Partial<T>
}

async function nextVendorNumber(entityId: string): Promise<string> {
  const count = await db.vendor.count({ where: { entityId } })
  return `V-${String(count + 1).padStart(4, '0')}`
}

// ─── GET ──────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const entityId = sp.get('entityId')
  if (!entityId) return NextResponse.json({ error: 'entityId required' }, { status: 400 })
  const auth = await requireEntityAccess(req, entityId, 'vendors:read')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const id = sp.get('id')
  if (id) {
    const v = await db.vendor.findFirst({
      where: { id, entityId },
      include: {
        services: { orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }] },
        attachments: { select: { id: true, filename: true, mimeType: true, size: true, uploadedBy: true, createdAt: true } },
        defaultAccount: { select: { code: true, name: true } },
        _count: { select: { apInvoices: true } },
      },
    })
    if (!v) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({
      ...v,
      creditLimit: v.creditLimit != null ? Number(v.creditLimit) : null,
      services: v.services.map(s => ({
        ...s,
        estimatedAmount: s.estimatedAmount != null ? Number(s.estimatedAmount) : null,
      })),
      invoiceCount: v._count.apInvoices,
    })
  }

  const statusFilter = sp.get('status') as VendorStatus | 'ALL' | null
  const q = (sp.get('q') ?? '').trim()
  const where: Record<string, unknown> = { entityId }
  if (statusFilter && statusFilter !== 'ALL') where.status = statusFilter
  if (q) {
    Object.assign(where, {
      OR: [
        { legalName:    { contains: q, mode: 'insensitive' } },
        { displayName:  { contains: q, mode: 'insensitive' } },
        { vendorNumber: { contains: q, mode: 'insensitive' } },
        { taxId:        { contains: q, mode: 'insensitive' } },
        { email:        { contains: q, mode: 'insensitive' } },
      ],
    })
  }

  const vendors = await db.vendor.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }],
    select: {
      id: true, vendorNumber: true, legalName: true, displayName: true,
      contactPerson: true, email: true, phone: true,
      taxId: true, taxIdType: true, is1099Vendor: true,
      paymentTerms: true, currency: true,
      status: true, submittedBy: true, submittedAt: true,
      approvedAt: true, rejectedAt: true, rejectionReason: true,
      _count: { select: { services: true, attachments: true, apInvoices: true } },
    },
    take: 1000,
  })

  // Status counts for tab badges
  const counts = await db.vendor.groupBy({
    by: ['status'],
    where: { entityId },
    _count: { status: true },
  })
  const summary = { PENDING_APPROVAL: 0, APPROVED: 0, REJECTED: 0, INACTIVE: 0, ALL: 0 }
  for (const c of counts) {
    summary[c.status as VendorStatus] = c._count.status
    summary.ALL += c._count.status
  }

  return NextResponse.json({
    vendors: vendors.map(v => ({
      ...v,
      servicesCount:    v._count.services,
      attachmentsCount: v._count.attachments,
      invoiceCount:     v._count.apInvoices,
    })),
    summary,
  })
}

// ─── POST: create ─────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const body = await req.json()
  // Detect workflow action via a `transition` key
  if (body && typeof body.transition === 'string') {
    return handleWorkflow(req, body)
  }

  const auth = await requireEntityAccess(req, body?.entityId, 'vendors:write')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const data = createSchema.parse(body)
    const cleaned = cleanFields(data)
    delete (cleaned as Record<string, unknown>).entityId

    const vendorNumber = (cleaned.vendorNumber as string) || (await nextVendorNumber(data.entityId))

    if (data.defaultAccountId) {
      const ok = await db.account.findFirst({ where: { id: data.defaultAccountId, entityId: data.entityId } })
      if (!ok) return NextResponse.json({ error: 'Default account not found in this entity' }, { status: 400 })
    }

    const created = await db.vendor.create({
      data: {
        ...(cleaned as Record<string, unknown>),
        entityId: data.entityId,
        vendorNumber,
        creditLimit: data.creditLimit != null && data.creditLimit !== '' ? Number(data.creditLimit) : null,
        status: 'PENDING_APPROVAL',
        submittedBy: auth.session?.userId,
        submittedAt: new Date(),
      },
    })

    await logAudit({
      entityId: data.entityId, userId: auth.session?.userId,
      action: 'VENDOR_SUBMITTED', resource: 'Vendor', resourceId: created.id,
      after: { legalName: created.legalName, vendorNumber: created.vendorNumber, status: created.status },
      request: req,
    })
    return NextResponse.json({ ...created, creditLimit: created.creditLimit != null ? Number(created.creditLimit) : null }, { status: 201 })
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: e.errors }, { status: 400 })
    if ((e as { code?: string }).code === 'P2002') {
      return NextResponse.json({ error: 'A vendor with that vendor number already exists in this entity' }, { status: 409 })
    }
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

// ─── PATCH: edit ──────────────────────────────────────────────────────────────
export async function PATCH(req: NextRequest) {
  const body = await req.json()
  const auth = await requireEntityAccess(req, body?.entityId, 'vendors:write')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const data = patchSchema.parse(body)
    const before = await db.vendor.findFirst({ where: { id: data.id, entityId: data.entityId } })
    if (!before) return NextResponse.json({ error: 'Vendor not found' }, { status: 404 })
    if (before.status === 'INACTIVE') {
      return NextResponse.json({ error: 'Cannot edit an INACTIVE vendor. Reactivate first.' }, { status: 409 })
    }

    const { entityId, id, ...rest } = data
    const cleaned = cleanFields(rest as Record<string, unknown>)
    const updated = await db.vendor.update({
      where: { id },
      data: {
        ...(cleaned as Record<string, unknown>),
        ...(data.creditLimit !== undefined
          ? { creditLimit: data.creditLimit === null || data.creditLimit === '' ? null : Number(data.creditLimit) }
          : {}),
      },
    })

    await logAudit({
      entityId, userId: auth.session?.userId,
      action: 'VENDOR_UPDATED', resource: 'Vendor', resourceId: id,
      before: { legalName: before.legalName, status: before.status },
      after:  { legalName: updated.legalName, status: updated.status },
      request: req,
    })

    return NextResponse.json({ ...updated, creditLimit: updated.creditLimit != null ? Number(updated.creditLimit) : null })
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: e.errors }, { status: 400 })
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
}

// ─── DELETE: archive when in use, hard delete when unused ─────────────────────
export async function DELETE(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const entityId = sp.get('entityId'); const id = sp.get('id')
  if (!entityId || !id) return NextResponse.json({ error: 'entityId, id required' }, { status: 400 })
  const auth = await requireEntityAccess(req, entityId, 'vendors:approve')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const v = await db.vendor.findFirst({
    where: { id, entityId },
    include: { _count: { select: { apInvoices: true } } },
  })
  if (!v) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (v._count.apInvoices > 0) {
    await db.vendor.update({ where: { id }, data: { status: 'INACTIVE' } })
    await logAudit({
      entityId, userId: auth.session?.userId,
      action: 'VENDOR_ARCHIVED', resource: 'Vendor', resourceId: id,
      before: { status: v.status }, after: { status: 'INACTIVE' },
      request: req,
    })
    return NextResponse.json({ softDeleted: true, reason: `Referenced by ${v._count.apInvoices} invoice(s)` })
  }
  await db.vendor.delete({ where: { id } })
  await logAudit({
    entityId, userId: auth.session?.userId,
    action: 'VENDOR_DELETED', resource: 'Vendor', resourceId: id,
    before: { legalName: v.legalName }, request: req,
  })
  return NextResponse.json({ deleted: true })
}

// ─── Workflow handler ─────────────────────────────────────────────────────────
async function handleWorkflow(req: NextRequest, body: unknown) {
  try {
    const data = workflowSchema.parse(body)
    const auth = await requireEntityAccess(req, data.entityId, 'vendors:approve')
    if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const v = await db.vendor.findFirst({ where: { id: data.id, entityId: data.entityId } })
    if (!v) return NextResponse.json({ error: 'Vendor not found' }, { status: 404 })

    const result = applyTransition({
      currentStatus: v.status as VendorStatus,
      action: data.transition as VendorAction,
      actor: { userId: auth.session?.userId },
      submittedBy: v.submittedBy,
      reason: data.reason,
    })
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.code === 'invalid_transition' ? 409 : 400 })
    }

    const updated = await db.vendor.update({
      where: { id: v.id },
      data: {
        status: result.nextStatus,
        ...result.approvedFields,
        ...result.rejectedFields,
        ...result.submittedFields,
        // When approving, clear any prior rejection reason; when resubmitting, clear it too
        ...(result.nextStatus === 'APPROVED'
          ? { rejectionReason: null, rejectedBy: null, rejectedAt: null }
          : {}),
        ...(data.transition === 'resubmit'
          ? { rejectionReason: null, rejectedBy: null, rejectedAt: null }
          : {}),
      },
    })

    await logAudit({
      entityId: data.entityId, userId: auth.session?.userId,
      action: `VENDOR_${data.transition.toUpperCase()}`,
      resource: 'Vendor', resourceId: v.id,
      before: { status: v.status },
      after:  { status: updated.status, rejectionReason: updated.rejectionReason },
      request: req,
    })

    return NextResponse.json({ ...updated, creditLimit: updated.creditLimit != null ? Number(updated.creditLimit) : null })
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: e.errors }, { status: 400 })
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireEntityAccess } from '@/lib/auth'
import { logAudit } from '@/lib/audit'
import { allowedActions, applyAction, actionAuditName, type WorkflowAction, type ApRequestStatus } from '@/lib/ap-workflow/state'

/**
 * /api/ap-requests
 *
 *   GET    ?entityId=                            → list (filtered by role)
 *   GET    ?entityId=&id=                        → detail with comments
 *   GET    ?entityId=&vendorDefault=&vendor=     → suggested account for a vendor (history-based)
 *   POST   { entityId, vendor, invoiceNo, ... }  → create new SUBMITTED request
 *   PATCH  { entityId, id, action, comment?, edit? } → apply workflow action / edit
 *   DELETE ?entityId=&id=                          → delete (with permission checks)
 *
 * The PATCH `edit` payload (only for SUBMITTED, RETURNED_TO_REQUESTER, APPROVED states)
 * accepts: vendor, invoiceNo, invoiceDate, dueDate, amount, accountId, paymentMode, description, attachmentId.
 * Accountants can edit APPROVED requests before posting; requesters can edit
 * RETURNED_TO_REQUESTER requests; nobody can edit POSTED requests.
 */

const PAYMENT_MODES = ['ACH', 'CHEQUE', 'WIRE', 'OTHER'] as const

const createSchema = z.object({
  entityId: z.string(),
  vendor: z.string().min(1).max(200),
  invoiceNo: z.string().min(1).max(100),
  invoiceDate: z.string(),
  dueDate: z.string().optional(),
  amount: z.number().positive(),
  accountId: z.string(),
  paymentMode: z.enum(PAYMENT_MODES).optional(),
  description: z.string().max(1000).optional(),
  attachmentId: z.string().optional(),
})

const editFieldsSchema = z.object({
  vendor: z.string().min(1).max(200).optional(),
  invoiceNo: z.string().min(1).max(100).optional(),
  invoiceDate: z.string().optional(),
  dueDate: z.string().nullable().optional(),
  amount: z.number().positive().optional(),
  accountId: z.string().optional(),
  paymentMode: z.enum(PAYMENT_MODES).nullable().optional(),
  description: z.string().max(1000).nullable().optional(),
  attachmentId: z.string().nullable().optional(),
})

const patchSchema = z.object({
  entityId: z.string(),
  id: z.string(),
  action: z.enum(['submit', 'approve', 'return-to-requester', 'return-to-approver', 'post', 'resubmit', 'delete', 'edit']),
  comment: z.string().max(2000).optional(),
  edit: editFieldsSchema.optional(),
})

// ─── helpers ────────────────────────────────────────────────────────────────

function statusFilter(sp: URLSearchParams) {
  const s = sp.get('status')
  if (!s || s === 'ALL') return undefined
  return s as ApRequestStatus
}

async function loadActor(entityId: string, userId: string) {
  const access = await db.entityAccess.findUnique({ where: { userId_entityId: { userId, entityId } } })
  return access?.role
}

// ─── GET ────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const entityId = sp.get('entityId')
  if (!entityId) return NextResponse.json({ error: 'entityId required' }, { status: 400 })

  const auth = await requireEntityAccess(req, entityId, 'ap:read')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  // Vendor-default lookup: returns most recently used accountId for that vendor.
  if (sp.get('vendorDefault') !== null) {
    const vendor = sp.get('vendor') ?? ''
    if (!vendor) return NextResponse.json({ error: 'vendor required' }, { status: 400 })
    // Look at the most recent posted AP invoice for this vendor (most reliable
    // signal). Fall back to the most recent ApRequest if no invoices exist yet.
    const recentInvoice = await db.apInvoice.findFirst({
      where: { entityId, vendor, accountId: { not: null }, status: { not: 'VOID' } },
      orderBy: { invoiceDate: 'desc' },
      select: { accountId: true },
    })
    if (recentInvoice?.accountId) {
      return NextResponse.json({ accountId: recentInvoice.accountId, source: 'invoice' })
    }
    const recentRequest = await db.apRequest.findFirst({
      where: { entityId, vendor, status: 'POSTED' },
      orderBy: { postedAt: 'desc' },
      select: { accountId: true },
    })
    if (recentRequest?.accountId) {
      return NextResponse.json({ accountId: recentRequest.accountId, source: 'request' })
    }
    return NextResponse.json({ accountId: null, source: null })
  }

  const id = sp.get('id')
  if (id) {
    const r = await db.apRequest.findFirst({
      where: { id, entityId },
      include: {
        account: { select: { id: true, code: true, name: true, type: true } },
        attachment: { select: { id: true, filename: true, mimeType: true, size: true } },
        apInvoice: { select: { id: true, status: true, invoiceNo: true } },
        comments: { orderBy: { createdAt: 'asc' } },
      },
    })
    if (!r) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // Resolve user names for the audit trail. The User relation is intentionally
    // not modeled on ApRequest/Comment to avoid relation explosion, so look up
    // names here in a single query.
    const userIds = new Set<string>()
    if (r.requesterId) userIds.add(r.requesterId)
    if (r.approverId) userIds.add(r.approverId)
    if (r.accountantId) userIds.add(r.accountantId)
    for (const c of r.comments) userIds.add(c.userId)
    const users = await db.user.findMany({
      where: { id: { in: [...userIds] } },
      select: { id: true, name: true, email: true },
    })
    const userMap = Object.fromEntries(users.map(u => [u.id, u]))

    return NextResponse.json({
      ...r,
      requester: userMap[r.requesterId] ?? null,
      approver: r.approverId ? userMap[r.approverId] ?? null : null,
      accountant: r.accountantId ? userMap[r.accountantId] ?? null : null,
      comments: r.comments.map(c => ({ ...c, user: userMap[c.userId] ?? null })),
      allowedActions: allowedActions(r.status, {
        role: auth.role,
        userId: auth.session!.userId,
        isRequester: r.requesterId === auth.session!.userId,
      }),
    })
  }

  // List view — filter by status optionally
  const status = statusFilter(sp)
  const requests = await db.apRequest.findMany({
    where: { entityId, ...(status ? { status } : {}) },
    include: {
      account: { select: { code: true, name: true } },
      attachment: { select: { id: true, filename: true } },
    },
    orderBy: [{ createdAt: 'desc' }],
    take: 500,
  })

  // Resolve user names in one query for the list.
  const userIds = new Set<string>(requests.map(r => r.requesterId))
  const users = await db.user.findMany({
    where: { id: { in: [...userIds] } },
    select: { id: true, name: true },
  })
  const userMap = Object.fromEntries(users.map(u => [u.id, u]))

  return NextResponse.json({
    requests: requests.map(r => ({
      ...r,
      requesterName: userMap[r.requesterId]?.name ?? '(unknown)',
    })),
  })
}

// ─── POST (create) ──────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const body = await req.json()
  const auth = await requireEntityAccess(req, body.entityId, 'ap-request:submit')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const data = createSchema.parse(body)
    // Validate the GL account belongs to this entity.
    const account = await db.account.findFirst({ where: { id: data.accountId, entityId: data.entityId } })
    if (!account) return NextResponse.json({ error: 'GL account not found in this entity' }, { status: 400 })

    const userId = auth.session!.userId
    const created = await db.apRequest.create({
      data: {
        entityId: data.entityId,
        vendor: data.vendor,
        invoiceNo: data.invoiceNo,
        invoiceDate: new Date(data.invoiceDate),
        dueDate: data.dueDate ? new Date(data.dueDate) : null,
        amount: data.amount,
        accountId: data.accountId,
        paymentMode: data.paymentMode,
        description: data.description,
        attachmentId: data.attachmentId,
        status: 'SUBMITTED',
        requesterId: userId,
        submittedAt: new Date(),
        comments: {
          create: { userId, action: 'SUBMITTED', comment: 'Request submitted' },
        },
      },
    })
    await logAudit({
      entityId: data.entityId, userId,
      action: 'AP_REQUEST_CREATED', resource: 'ApRequest', resourceId: created.id,
      after: { vendor: created.vendor, amount: created.amount, accountId: created.accountId },
      request: req,
    })
    return NextResponse.json(created, { status: 201 })
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: e.errors }, { status: 400 })
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
}

// ─── PATCH (workflow actions + edit) ────────────────────────────────────────

export async function PATCH(req: NextRequest) {
  try {
    const body = patchSchema.parse(await req.json())
    const auth = await requireEntityAccess(req, body.entityId, 'ap:read')
    if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const before = await db.apRequest.findFirst({ where: { id: body.id, entityId: body.entityId } })
    if (!before) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const userId = auth.session!.userId
    const actor = {
      role: auth.role,
      userId,
      isRequester: before.requesterId === userId,
    }

    // Edit-only action (no state change)
    if (body.action === 'edit') {
      // Editable in SUBMITTED (by requester), RETURNED_TO_REQUESTER (by requester),
      // and APPROVED (by accountant). Not editable in POSTED or RETURNED_TO_APPROVER.
      const canEditAsRequester = actor.isRequester && (before.status === 'SUBMITTED' || before.status === 'RETURNED_TO_REQUESTER')
      const canEditAsAccountant = (actor.role === 'ACCOUNTANT' || actor.role === 'ADMIN' || actor.role === 'OWNER') && before.status === 'APPROVED'
      if (!canEditAsRequester && !canEditAsAccountant) {
        return NextResponse.json({ error: `Cannot edit a request in status ${before.status} with role ${actor.role}` }, { status: 403 })
      }
      const patch = body.edit ?? {}
      // If accountId is changing, validate it belongs to entity.
      if (patch.accountId && patch.accountId !== before.accountId) {
        const acct = await db.account.findFirst({ where: { id: patch.accountId, entityId: body.entityId } })
        if (!acct) return NextResponse.json({ error: 'GL account not found' }, { status: 400 })
      }
      const updateData: Record<string, unknown> = {}
      if (patch.vendor !== undefined) updateData.vendor = patch.vendor
      if (patch.invoiceNo !== undefined) updateData.invoiceNo = patch.invoiceNo
      if (patch.invoiceDate !== undefined) updateData.invoiceDate = new Date(patch.invoiceDate)
      if (patch.dueDate !== undefined) updateData.dueDate = patch.dueDate ? new Date(patch.dueDate) : null
      if (patch.amount !== undefined) updateData.amount = patch.amount
      if (patch.accountId !== undefined) updateData.accountId = patch.accountId
      if (patch.paymentMode !== undefined) updateData.paymentMode = patch.paymentMode
      if (patch.description !== undefined) updateData.description = patch.description
      if (patch.attachmentId !== undefined) updateData.attachmentId = patch.attachmentId

      const updated = await db.apRequest.update({
        where: { id: body.id },
        data: {
          ...updateData,
          comments: { create: { userId, action: 'EDITED', comment: body.comment ?? 'Fields updated' } },
        },
      })
      await logAudit({
        entityId: body.entityId, userId,
        action: 'AP_REQUEST_EDITED', resource: 'ApRequest', resourceId: body.id,
        before, after: updateData, request: req,
      })
      return NextResponse.json(updated)
    }

    // State-changing action — defer to the state machine
    const action = body.action as WorkflowAction
    const next = applyAction(before.status as ApRequestStatus, action, actor)

    // 'delete' is the only action that doesn't change state but removes the row
    if (action === 'delete') {
      // Only DRAFT/SUBMITTED (own) or RETURNED_TO_REQUESTER (own) deletable.
      // State machine already validated permission.
      await db.apRequest.delete({ where: { id: body.id } })
      await logAudit({
        entityId: body.entityId, userId,
        action: 'AP_REQUEST_DELETED', resource: 'ApRequest', resourceId: body.id,
        before, request: req,
      })
      return NextResponse.json({ deleted: true })
    }

    // 'post' is the heavy action — it creates an ApInvoice + journal entry.
    if (action === 'post') {
      const account = await db.account.findFirst({ where: { id: before.accountId, entityId: body.entityId } })
      if (!account) return NextResponse.json({ error: 'GL account not found' }, { status: 400 })

      // Locate the AP control account (currently hard-coded to code "2000" to
      // match the existing AP flow). Future: per-entity setting.
      const apAccount = await db.account.findFirst({
        where: { entityId: body.entityId, code: '2000' },
      })
      if (!apAccount) {
        return NextResponse.json({
          error: 'AP control account (code 2000) not found. Create a liability account with code 2000 first.',
        }, { status: 400 })
      }

      // Create everything in a transaction so the request, ApInvoice, and JE
      // all land together or none of them do.
      const result = await db.$transaction(async (tx) => {
        const invoice = await tx.apInvoice.create({
          data: {
            entityId: body.entityId,
            vendor: before.vendor,
            invoiceNo: before.invoiceNo,
            invoiceDate: before.invoiceDate,
            dueDate: before.dueDate ?? before.invoiceDate,
            amount: before.amount,
            accountId: before.accountId,
            notes: before.description,
            attachment: undefined,                      // legacy text field; we use attachmentId via request
            status: 'PENDING',
          },
        })

        const count = await tx.journalEntry.count({ where: { entityId: body.entityId } })
        const je = await tx.journalEntry.create({
          data: {
            entityId: body.entityId,
            ref: `APR-${new Date().getFullYear()}-${String(count + 1).padStart(4, '0')}`,
            date: before.invoiceDate,
            description: `AP Request: ${before.vendor} #${before.invoiceNo}`,
            status: 'POSTED',
            source: 'AP',
            postedAt: new Date(),
            createdBy: userId,
            lines: {
              create: [
                { accountId: before.accountId, debit: before.amount, credit: 0, lineOrder: 0,
                  description: `${before.vendor} - ${before.invoiceNo}` },
                { accountId: apAccount.id, debit: 0, credit: before.amount, lineOrder: 1,
                  description: `AP to ${before.vendor}` },
              ],
            },
          },
        })

        const updatedRequest = await tx.apRequest.update({
          where: { id: body.id },
          data: {
            status: 'POSTED',
            accountantId: userId,
            postedAt: new Date(),
            apInvoiceId: invoice.id,
            comments: {
              create: {
                userId,
                action: 'POSTED',
                comment: body.comment ?? `Posted to GL — JE ${je.ref}`,
              },
            },
          },
        })

        return { invoice, je, updatedRequest }
      })

      await logAudit({
        entityId: body.entityId, userId,
        action: 'AP_REQUEST_POSTED', resource: 'ApRequest', resourceId: body.id,
        before, after: {
          apInvoiceId: result.invoice.id, journalEntryRef: result.je.ref,
        }, request: req,
      })
      return NextResponse.json(result.updatedRequest)
    }

    // Generic state transition (approve, return-*, resubmit)
    const updates: Record<string, unknown> = { status: next }
    if (action === 'approve') {
      updates.approverId = userId
      updates.approvedAt = new Date()
    } else if (action === 'resubmit') {
      updates.submittedAt = new Date()
    }
    const updated = await db.apRequest.update({
      where: { id: body.id },
      data: {
        ...updates,
        comments: {
          create: {
            userId,
            action: actionAuditName(action),
            comment: body.comment ?? null,
          },
        },
      },
    })

    await logAudit({
      entityId: body.entityId, userId,
      action: `AP_REQUEST_${actionAuditName(action)}`, resource: 'ApRequest', resourceId: body.id,
      before: { status: before.status }, after: { status: next }, request: req,
    })

    return NextResponse.json(updated)
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: e.errors }, { status: 400 })
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
}

// ─── DELETE ─────────────────────────────────────────────────────────────────

export async function DELETE(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const entityId = sp.get('entityId'); const id = sp.get('id')
  if (!entityId || !id) return NextResponse.json({ error: 'entityId, id required' }, { status: 400 })

  const auth = await requireEntityAccess(req, entityId, 'ap:read')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const before = await db.apRequest.findFirst({ where: { id, entityId } })
  if (!before) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const actor = { role: auth.role, userId: auth.session!.userId, isRequester: before.requesterId === auth.session!.userId }
  if (!allowedActions(before.status as ApRequestStatus, actor).includes('delete')) {
    return NextResponse.json({ error: 'Not allowed to delete in current state' }, { status: 403 })
  }
  await db.apRequest.delete({ where: { id } })
  await logAudit({
    entityId, userId: auth.session!.userId,
    action: 'AP_REQUEST_DELETED', resource: 'ApRequest', resourceId: id,
    before, request: req,
  })
  return NextResponse.json({ deleted: true })
}

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireEntityAccess } from '@/lib/auth'
import { logAudit } from '@/lib/audit'

/**
 * Chart of Accounts API.
 *   GET    ?entityId=                       → list (with usage counts for UI lock logic)
 *   POST   create
 *   PATCH  edit (code/type locked once used)
 *   DELETE ?entityId=&id=                   → soft-delete if used, hard-delete if unused
 */

export async function GET(req: NextRequest) {
  const entityId = req.nextUrl.searchParams.get('entityId')
  if (!entityId) return NextResponse.json({ error: 'entityId required' }, { status: 400 })
  const auth = await requireEntityAccess(req, entityId, 'accounts:read')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const accounts = await db.account.findMany({
    where: { entityId, isActive: true },
    orderBy: [{ type: 'asc' }, { code: 'asc' }],
    include: { _count: { select: { journalLines: true } } },
  })
  // Surface usage count flat for the UI.
  const flat = accounts.map(a => {
    const { _count, ...rest } = a
    return { ...rest, usageCount: _count.journalLines }
  })
  return NextResponse.json(flat)
}

const createSchema = z.object({
  entityId: z.string(),
  code: z.string().min(1).max(40),
  name: z.string().min(1).max(200),
  type: z.enum(['ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE','COGS']),
  subType: z.string().max(100).optional(),
  description: z.string().max(500).optional(),
  parentId: z.string().nullable().optional(),
  isBankAccount: z.boolean().optional(),
  taxCode: z.string().optional(),
})

export async function POST(req: NextRequest) {
  const body = await req.json()
  const auth = await requireEntityAccess(req, body.entityId, 'accounts:write')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  try {
    const data = createSchema.parse(body)
    if (data.parentId) {
      // Validate parent belongs to same entity and isn't deactivated.
      const parent = await db.account.findFirst({ where: { id: data.parentId, entityId: data.entityId } })
      if (!parent) return NextResponse.json({ error: 'Parent account not found in this entity' }, { status: 400 })
    }
    const account = await db.account.create({ data: { ...data, parentId: data.parentId ?? null } })
    await logAudit({
      entityId: data.entityId, userId: auth.session?.userId,
      action: 'ACCOUNT_CREATED', resource: 'Account', resourceId: account.id,
      after: { code: account.code, name: account.name, type: account.type, isBankAccount: account.isBankAccount },
      request: req,
    })
    return NextResponse.json(account, { status: 201 })
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: e.errors }, { status: 400 })
    if ((e as {code?:string}).code === 'P2002') return NextResponse.json({ error: 'Account code already exists' }, { status: 409 })
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

const patchSchema = z.object({
  entityId: z.string(),
  id: z.string(),
  code: z.string().min(1).max(40).optional(),
  name: z.string().min(1).max(200).optional(),
  type: z.enum(['ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE','COGS']).optional(),
  subType: z.string().max(100).nullable().optional(),
  description: z.string().max(500).nullable().optional(),
  parentId: z.string().nullable().optional(),
  isBankAccount: z.boolean().optional(),
  taxCode: z.string().nullable().optional(),
})

export async function PATCH(req: NextRequest) {
  const body = await req.json()
  try {
    const data = patchSchema.parse(body)
    const auth = await requireEntityAccess(req, data.entityId, 'accounts:write')
    if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const before = await db.account.findFirst({
      where: { id: data.id, entityId: data.entityId },
      include: { _count: { select: { journalLines: true } } },
    })
    if (!before) return NextResponse.json({ error: 'Account not found' }, { status: 404 })

    const inUse = before._count.journalLines > 0

    // Hard-block: changing code or type after the account has been used would
    // corrupt journal references and downstream reports.
    if (inUse) {
      if (data.code && data.code !== before.code) {
        return NextResponse.json({
          error: `Cannot change code — account is used in ${before._count.journalLines} journal line(s). Create a new account instead.`,
        }, { status: 409 })
      }
      if (data.type && data.type !== before.type) {
        return NextResponse.json({
          error: `Cannot change type — account is used in ${before._count.journalLines} journal line(s). Type changes corrupt P&L vs Balance Sheet classifications.`,
        }, { status: 409 })
      }
    }

    // Cycle detection for parentId.
    if (data.parentId === data.id) {
      return NextResponse.json({ error: 'An account cannot be its own parent' }, { status: 400 })
    }
    if (data.parentId) {
      let cursor: string | null = data.parentId
      const seen = new Set<string>()
      while (cursor) {
        if (cursor === data.id) {
          return NextResponse.json({ error: 'This parent change would create a circular hierarchy' }, { status: 400 })
        }
        if (seen.has(cursor)) break
        seen.add(cursor)
        const row: { parentId: string | null } | null = await db.account.findUnique({
          where: { id: cursor }, select: { parentId: true },
        })
        cursor = row?.parentId ?? null
      }
    }

    const { entityId, id, ...patch } = data
    const updated = await db.account.update({ where: { id }, data: patch })
    await logAudit({
      entityId, userId: auth.session?.userId,
      action: 'ACCOUNT_UPDATED', resource: 'Account', resourceId: id,
      before: { code: before.code, name: before.name, type: before.type, subType: before.subType, isBankAccount: before.isBankAccount, parentId: before.parentId },
      after:  { code: updated.code, name: updated.name, type: updated.type, subType: updated.subType, isBankAccount: updated.isBankAccount, parentId: updated.parentId },
      request: req,
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
  const auth = await requireEntityAccess(req, entityId, 'accounts:write')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const before = await db.account.findFirst({
    where: { id, entityId },
    include: { _count: { select: { journalLines: true, apInvoices: true } } },
  })
  if (!before) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Soft-delete if used; hard-delete if unused.
  const used = before._count.journalLines + before._count.apInvoices
  if (used > 0) {
    await db.account.update({ where: { id }, data: { isActive: false } })
    await logAudit({
      entityId, userId: auth.session?.userId,
      action: 'ACCOUNT_DEACTIVATED', resource: 'Account', resourceId: id,
      before: { code: before.code, name: before.name, type: before.type }, request: req,
    })
    return NextResponse.json({ softDeleted: true, reason: `Used in ${used} record(s)` })
  }
  await db.account.delete({ where: { id } })
  await logAudit({
    entityId, userId: auth.session?.userId,
    action: 'ACCOUNT_DELETED', resource: 'Account', resourceId: id,
    before, request: req,
  })
  return NextResponse.json({ deleted: true })
}

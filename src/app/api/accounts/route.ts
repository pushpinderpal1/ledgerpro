import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireEntityAccess } from '@/lib/auth'
import { logAudit } from '@/lib/audit'
import { upsertOpeningBalanceJE } from '@/lib/opening-balance/db'

/**
 * Chart of Accounts API.
 *
 *   GET    ?entityId=                  → list (usage counts for UI lock logic)
 *   GET    ?entityId=&withBalances=1   → list + posted-JE balance per account
 *   POST   create  (optionally with openingBalance — auto-posts OB JE)
 *   PATCH  edit    (openingBalance change auto-updates OB JE)
 *   DELETE ?entityId=&id=              → soft-delete if used, hard-delete if unused
 */

const numericLikeSchema = z.union([z.number(), z.string()]).transform(v => {
  if (typeof v === 'number') return v
  const n = parseFloat(v)
  return Number.isFinite(n) ? n : 0
})

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const entityId = sp.get('entityId')
  if (!entityId) return NextResponse.json({ error: 'entityId required' }, { status: 400 })
  const auth = await requireEntityAccess(req, entityId, 'accounts:read')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const accounts = await db.account.findMany({
    where: { entityId, isActive: true },
    orderBy: [{ type: 'asc' }, { code: 'asc' }],
    include: { _count: { select: { journalLines: true } } },
  })

  const flat = accounts.map(a => {
    const { _count, ...rest } = a
    return {
      ...rest,
      openingBalance: Number(rest.openingBalance ?? 0),
      usageCount: _count.journalLines,
    }
  })

  if (sp.get('withBalances') !== '1') {
    return NextResponse.json(flat)
  }

  // Compute current balance per account from posted JE lines.
  // Two-step to avoid Prisma groupBy + relation-filter compatibility quirks:
  //   1. Get POSTED journal entry IDs for this entity
  //   2. Sum debit/credit on journal_lines filtered by those JE IDs
  // Failure to compute balances should NOT prevent COA from rendering —
  // we degrade gracefully to currentBalance = 0 for every account.
  try {
    const postedJes = await db.journalEntry.findMany({
      where: { entityId, status: 'POSTED' },
      select: { id: true },
    })
    const jeIds = postedJes.map(j => j.id)
    const balanceMap = new Map<string, number>()
    if (jeIds.length > 0) {
      const rows = await db.journalLine.groupBy({
        by: ['accountId'],
        where: { journalEntryId: { in: jeIds } },
        _sum: { debit: true, credit: true },
      })
      for (const r of rows) {
        const dr = Number(r._sum.debit ?? 0)
        const cr = Number(r._sum.credit ?? 0)
        balanceMap.set(r.accountId, dr - cr)
      }
    }
    return NextResponse.json(flat.map(a => ({
      ...a,
      currentBalance: balanceMap.get(a.id) ?? 0,
    })))
  } catch (e) {
    console.error('[accounts GET] balance computation failed', e)
    // Degrade: still return the account list so the COA page renders.
    return NextResponse.json(flat.map(a => ({ ...a, currentBalance: 0, balanceError: true })))
  }
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
  openingBalance: numericLikeSchema.optional(),
})

export async function POST(req: NextRequest) {
  const body = await req.json()
  const auth = await requireEntityAccess(req, body.entityId, 'accounts:write')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  try {
    const data = createSchema.parse(body)
    if (data.parentId) {
      const parent = await db.account.findFirst({ where: { id: data.parentId, entityId: data.entityId } })
      if (!parent) return NextResponse.json({ error: 'Parent account not found in this entity' }, { status: 400 })
    }
    const opening = data.openingBalance ?? 0

    const account = await db.$transaction(async (tx) => {
      const created = await tx.account.create({
        data: {
          ...data,
          parentId: data.parentId ?? null,
          openingBalance: opening,
        },
      })
      if (opening !== 0) {
        await upsertOpeningBalanceJE(tx, {
          entityId: data.entityId,
          account: { id: created.id, code: created.code, name: created.name, type: created.type },
          openingBalance: opening,
          createdBy: auth.session?.userId,
        })
      }
      return created
    })

    await logAudit({
      entityId: data.entityId, userId: auth.session?.userId,
      action: 'ACCOUNT_CREATED', resource: 'Account', resourceId: account.id,
      after: { code: account.code, name: account.name, type: account.type, isBankAccount: account.isBankAccount, openingBalance: opening },
      request: req,
    })
    return NextResponse.json({ ...account, openingBalance: opening }, { status: 201 })
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
  openingBalance: numericLikeSchema.optional(),
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

    // Exclude opening-balance JEs from the "in-use" check so users can
    // ADJUST opening balances even after one has been posted. Only block
    // when there are NON-OB postings.
    const nonObUsage = await db.journalLine.count({
      where: {
        accountId: data.id,
        journalEntry: { source: { not: 'OPENING_BALANCE' } },
      },
    })
    const inUse = nonObUsage > 0

    if (inUse) {
      if (data.code && data.code !== before.code) {
        return NextResponse.json({
          error: `Cannot change code - account is used in ${nonObUsage} journal line(s). Create a new account instead.`,
        }, { status: 409 })
      }
      if (data.type && data.type !== before.type) {
        return NextResponse.json({
          error: `Cannot change type - account is used in ${nonObUsage} journal line(s). Type changes corrupt P&L vs Balance Sheet classifications.`,
        }, { status: 409 })
      }
    }

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

    const { entityId, id, openingBalance: newOpening, ...patch } = data
    const openingChanged = newOpening !== undefined && Number(newOpening) !== Number(before.openingBalance)

    const updated = await db.$transaction(async (tx) => {
      const u = await tx.account.update({
        where: { id },
        data: {
          ...patch,
          ...(newOpening !== undefined ? { openingBalance: newOpening } : {}),
        },
      })
      if (openingChanged) {
        await upsertOpeningBalanceJE(tx, {
          entityId,
          account: { id: u.id, code: u.code, name: u.name, type: u.type },
          openingBalance: Number(newOpening),
          createdBy: auth.session?.userId,
        })
      }
      return u
    })

    await logAudit({
      entityId, userId: auth.session?.userId,
      action: 'ACCOUNT_UPDATED', resource: 'Account', resourceId: id,
      before: { code: before.code, name: before.name, type: before.type, openingBalance: Number(before.openingBalance) },
      after:  { code: updated.code, name: updated.name, type: updated.type, openingBalance: Number(updated.openingBalance) },
      request: req,
    })
    return NextResponse.json({ ...updated, openingBalance: Number(updated.openingBalance) })
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

  // For deletion: count only non-OB usage. If the only usage is the OB JE
  // itself, the delete proceeds (we clean up the OB JE first).
  const nonObUsage = await db.journalLine.count({
    where: {
      accountId: id,
      journalEntry: { source: { not: 'OPENING_BALANCE' } },
    },
  })
  const used = nonObUsage + before._count.apInvoices

  if (used > 0) {
    await db.account.update({ where: { id }, data: { isActive: false } })
    await logAudit({
      entityId, userId: auth.session?.userId,
      action: 'ACCOUNT_DEACTIVATED', resource: 'Account', resourceId: id,
      before: { code: before.code, name: before.name, type: before.type }, request: req,
    })
    return NextResponse.json({ softDeleted: true, reason: `Used in ${used} record(s)` })
  }

  await db.$transaction(async (tx) => {
    await upsertOpeningBalanceJE(tx, {
      entityId,
      account: { id, code: before.code, name: before.name, type: before.type },
      openingBalance: 0,
    })
    await tx.account.delete({ where: { id } })
  })
  await logAudit({
    entityId, userId: auth.session?.userId,
    action: 'ACCOUNT_DELETED', resource: 'Account', resourceId: id,
    before, request: req,
  })
  return NextResponse.json({ deleted: true })
}

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { getSessionFromRequest, hashPassword } from '@/lib/auth'
import type { EntityRole } from '@prisma/client'

// ─── GET /api/entities — list all entities user has access to ─────────────────
export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const where = session.isSuperAdmin
    ? {}
    : { userAccess: { some: { userId: session.userId, isActive: true } } }

  const entities = await db.legalEntity.findMany({
    where,
    include: {
      userAccess: {
        where: { userId: session.userId },
        select: { role: true },
      },
      _count: { select: { accounts: true, employees: true, journalEntries: true } },
    },
    orderBy: { name: 'asc' },
  })

  return NextResponse.json(entities)
}

// ─── POST /api/entities — create new legal entity ─────────────────────────────
const createSchema = z.object({
  name: z.string().min(2),
  taxId: z.string().optional(),
  address: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  currency: z.string().default('USD'),
  fiscalMonth: z.number().min(1).max(12).default(1),
})

export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await req.json()
    const data = createSchema.parse(body)

    const slug = data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 50)
    const slugExists = await db.legalEntity.findUnique({ where: { slug } })
    const finalSlug = slugExists ? `${slug}-${Date.now()}` : slug

    const entity = await db.$transaction(async (tx) => {
      const e = await tx.legalEntity.create({ data: { ...data, slug: finalSlug } })
      await tx.entityAccess.create({
        data: { userId: session.userId, entityId: e.id, role: 'OWNER', grantedBy: session.userId },
      })
      // Seed default CoA
      await tx.account.createMany({ data: defaultCoaForEntity(e.id) })
      return e
    })

    return NextResponse.json(entity, { status: 201 })
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: e.errors }, { status: 400 })
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

// ─── User management within entity ───────────────────────────────────────────

export async function manageEntityUsers(
  req: NextRequest,
  entityId: string,
  action: 'invite' | 'update' | 'remove'
) {
  const session = await getSessionFromRequest(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const callerAccess = session.isSuperAdmin
    ? { role: 'OWNER' as EntityRole }
    : await db.entityAccess.findUnique({
        where: { userId_entityId: { userId: session.userId, entityId } },
      })

  if (!callerAccess || !['OWNER', 'ADMIN'].includes(callerAccess.role)) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const body = await req.json()

  if (action === 'invite') {
    const { email, role, name, tempPassword } = body as {
      email: string; role: EntityRole; name: string; tempPassword: string
    }

    let user = await db.user.findUnique({ where: { email: email.toLowerCase() } })

    if (!user) {
      user = await db.user.create({
        data: {
          email: email.toLowerCase(),
          name,
          passwordHash: await hashPassword(tempPassword ?? 'ChangeMe123!'),
        },
      })
    }

    const existing = await db.entityAccess.findUnique({
      where: { userId_entityId: { userId: user.id, entityId } },
    })

    if (existing) {
      await db.entityAccess.update({
        where: { userId_entityId: { userId: user.id, entityId } },
        data: { role, isActive: true },
      })
    } else {
      await db.entityAccess.create({
        data: { userId: user.id, entityId, role, grantedBy: session.userId },
      })
    }

    await db.auditLog.create({
      data: {
        entityId, userId: session.userId,
        action: existing ? 'USER_ROLE_UPDATED' : 'USER_INVITED',
        resource: 'EntityAccess', resourceId: user.id,
        newValue: JSON.stringify({ email, role }),
      },
    })

    return NextResponse.json({ success: true, userId: user.id })
  }

  if (action === 'update') {
    const { userId, role } = body as { userId: string; role: EntityRole }
    await db.entityAccess.update({
      where: { userId_entityId: { userId, entityId } },
      data: { role },
    })
    return NextResponse.json({ success: true })
  }

  if (action === 'remove') {
    const { userId } = body as { userId: string }
    if (userId === session.userId) {
      return NextResponse.json({ error: 'Cannot remove yourself' }, { status: 400 })
    }
    await db.entityAccess.update({
      where: { userId_entityId: { userId, entityId } },
      data: { isActive: false },
    })
    return NextResponse.json({ success: true })
  }
}

function defaultCoaForEntity(entityId: string) {
  return [
    { entityId, code: '1000', name: 'Cash & Equivalents', type: 'ASSET' as const, subType: 'Current', isBankAccount: true },
    { entityId, code: '1100', name: 'Accounts Receivable', type: 'ASSET' as const, subType: 'Current' },
    { entityId, code: '2000', name: 'Accounts Payable', type: 'LIABILITY' as const, subType: 'Current' },
    { entityId, code: '2100', name: 'Accrued Liabilities', type: 'LIABILITY' as const, subType: 'Current' },
    { entityId, code: '3000', name: 'Common Stock', type: 'EQUITY' as const, subType: 'Capital' },
    { entityId, code: '3100', name: 'Retained Earnings', type: 'EQUITY' as const, subType: 'Earnings' },
    { entityId, code: '4000', name: 'Sales Revenue', type: 'REVENUE' as const, subType: 'Operating' },
    { entityId, code: '6000', name: 'Salaries & Wages', type: 'EXPENSE' as const, subType: 'Payroll' },
    { entityId, code: '6300', name: 'Rent & Facilities', type: 'EXPENSE' as const, subType: 'Facility' },
    { entityId, code: '6500', name: 'Marketing & Advertising', type: 'EXPENSE' as const, subType: 'Marketing' },
  ]
}

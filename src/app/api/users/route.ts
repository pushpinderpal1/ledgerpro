import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireEntityAccess, hashPassword } from '@/lib/auth'
import type { EntityRole } from '@prisma/client'

// GET /api/users?entityId= — list all users for an entity
export async function GET(req: NextRequest) {
  const entityId = req.nextUrl.searchParams.get('entityId')
  if (!entityId) return NextResponse.json({ error: 'entityId required' }, { status: 400 })

  const auth = await requireEntityAccess(req, entityId, 'users:read')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const access = await db.entityAccess.findMany({
    where: { entityId, isActive: true },
    include: {
      user: {
        select: {
          id: true, name: true, email: true, lastLoginAt: true,
          createdAt: true, isActive: true, isSuperAdmin: true,
        },
      },
    },
    orderBy: { grantedAt: 'asc' },
  })

  return NextResponse.json(access)
}

const inviteSchema = z.object({
  entityId:    z.string(),
  email:       z.string().email(),
  name:        z.string().min(2),
  role:        z.enum(['OWNER','ADMIN','ACCOUNTANT','AUDITOR','AP_CLERK','PAYROLL_CLERK','CLIENT_VIEW']),
  tempPassword: z.string().min(8).optional(),
})

// POST /api/users — invite or assign user to entity
export async function POST(req: NextRequest) {
  const body = await req.json()
  const entityId = body.entityId
  if (!entityId) return NextResponse.json({ error: 'entityId required' }, { status: 400 })

  const auth = await requireEntityAccess(req, entityId, 'users:write')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const data = inviteSchema.parse(body)
    const tempPwd = data.tempPassword ?? `Welcome${Math.floor(Math.random() * 9000 + 1000)}!`

    // Find or create user
    let user = await db.user.findUnique({ where: { email: data.email.toLowerCase() } })
    let isNew = false

    if (!user) {
      user = await db.user.create({
        data: {
          email: data.email.toLowerCase(),
          name: data.name,
          passwordHash: await hashPassword(tempPwd),
        },
      })
      isNew = true
    }

    // Upsert entity access
    const existing = await db.entityAccess.findUnique({
      where: { userId_entityId: { userId: user.id, entityId: data.entityId } },
    })

    if (existing) {
      await db.entityAccess.update({
        where: { userId_entityId: { userId: user.id, entityId: data.entityId } },
        data: { role: data.role as EntityRole, isActive: true },
      })
    } else {
      await db.entityAccess.create({
        data: {
          userId:    user.id,
          entityId:  data.entityId,
          role:      data.role as EntityRole,
          grantedBy: auth.session?.userId,
        },
      })
    }

    await db.auditLog.create({
      data: {
        entityId,
        userId: auth.session?.userId,
        action: existing ? 'USER_ROLE_UPDATED' : 'USER_INVITED',
        resource: 'EntityAccess',
        resourceId: user.id,
        newValue: JSON.stringify({ email: data.email, role: data.role }),
      },
    })

    return NextResponse.json({
      userId: user.id,
      email:  user.email,
      name:   user.name,
      role:   data.role,
      isNew,
      tempPassword: isNew ? tempPwd : undefined,
    }, { status: 201 })
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: e.errors }, { status: 400 })
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

// PATCH /api/users — update role
export async function PATCH(req: NextRequest) {
  const body = await req.json()
  const { entityId, userId, role } = body
  if (!entityId) return NextResponse.json({ error: 'entityId required' }, { status: 400 })

  const auth = await requireEntityAccess(req, entityId, 'users:write')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  // Prevent demoting the last OWNER
  if (role !== 'OWNER') {
    const owners = await db.entityAccess.count({
      where: { entityId, role: 'OWNER', isActive: true },
    })
    const targetAccess = await db.entityAccess.findUnique({
      where: { userId_entityId: { userId, entityId } },
    })
    if (owners === 1 && targetAccess?.role === 'OWNER') {
      return NextResponse.json({ error: 'Cannot demote the last owner' }, { status: 400 })
    }
  }

  const updated = await db.entityAccess.update({
    where: { userId_entityId: { userId, entityId } },
    data: { role: role as EntityRole },
    include: { user: { select: { name: true, email: true } } },
  })

  await db.auditLog.create({
    data: {
      entityId, userId: auth.session?.userId,
      action: 'USER_ROLE_UPDATED', resource: 'EntityAccess', resourceId: userId,
      newValue: JSON.stringify({ role }),
    },
  })

  return NextResponse.json(updated)
}

// DELETE /api/users — remove user from entity
export async function DELETE(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const entityId = searchParams.get('entityId')
  const userId   = searchParams.get('userId')
  if (!entityId || !userId) return NextResponse.json({ error: 'entityId and userId required' }, { status: 400 })

  const auth = await requireEntityAccess(req, entityId, 'users:write')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  if (userId === auth.session?.userId) {
    return NextResponse.json({ error: 'Cannot remove yourself' }, { status: 400 })
  }

  await db.entityAccess.update({
    where: { userId_entityId: { userId, entityId } },
    data: { isActive: false },
  })

  await db.auditLog.create({
    data: {
      entityId, userId: auth.session?.userId,
      action: 'USER_REMOVED', resource: 'EntityAccess', resourceId: userId,
    },
  })

  return NextResponse.json({ success: true })
}

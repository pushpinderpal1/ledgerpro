import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { getSessionFromRequest, requireEntityAccess } from '@/lib/auth'
import { logAudit } from '@/lib/audit'

/**
 * Group structure API.
 *
 *   GET    /api/group                       → corporate tree (entities the user can see)
 *   PATCH  /api/group  { action: 'set-parent', entityId, parentEntityId, ownershipPercent?, acquisitionDate?, entityType? }
 *   PATCH  /api/group  { action: 'detach', entityId }   → removes parent link
 *
 * Only OWNER of the child entity (and ADMIN+ on the parent, if a parent is set)
 * can change structure. Detachments require OWNER on the child.
 */

interface TreeNode {
  id: string
  name: string
  slug: string
  currency: string
  entityType: string
  parentEntityId: string | null
  ownershipPercent: number
  acquisitionDate: Date | null
  children: TreeNode[]
}

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Pull every entity the user has access to (super-admin sees all).
  const where = session.isSuperAdmin
    ? {}
    : { userAccess: { some: { userId: session.userId, isActive: true } } }

  const flat = await db.legalEntity.findMany({
    where,
    select: {
      id: true, name: true, slug: true, currency: true, entityType: true,
      parentEntityId: true, ownershipPercent: true, acquisitionDate: true,
    },
    orderBy: { name: 'asc' },
  })

  // Build the forest. An entity whose parent isn't in the visible set is
  // promoted to top-level so the user still sees it.
  const idSet = new Set(flat.map(e => e.id))
  const byId = new Map<string, TreeNode>()
  for (const e of flat) {
    byId.set(e.id, {
      id: e.id, name: e.name, slug: e.slug, currency: e.currency,
      entityType: e.entityType, parentEntityId: e.parentEntityId,
      ownershipPercent: Number(e.ownershipPercent),
      acquisitionDate: e.acquisitionDate, children: [],
    })
  }
  const roots: TreeNode[] = []
  for (const e of flat) {
    const node = byId.get(e.id)!
    if (e.parentEntityId && idSet.has(e.parentEntityId)) {
      byId.get(e.parentEntityId)!.children.push(node)
    } else {
      roots.push(node)
    }
  }
  return NextResponse.json({ tree: roots })
}

const setParentSchema = z.object({
  action: z.literal('set-parent'),
  entityId: z.string(),
  parentEntityId: z.string(),
  ownershipPercent: z.number().min(0).max(100).optional(),
  acquisitionDate: z.string().optional(),
  entityType: z.enum(['STANDALONE', 'HOLDING', 'SUBSIDIARY', 'BRANCH']).optional(),
})
const detachSchema = z.object({
  action: z.literal('detach'),
  entityId: z.string(),
})
const updateMetaSchema = z.object({
  action: z.literal('update-meta'),
  entityId: z.string(),
  ownershipPercent: z.number().min(0).max(100).optional(),
  acquisitionDate: z.string().nullable().optional(),
  entityType: z.enum(['STANDALONE', 'HOLDING', 'SUBSIDIARY', 'BRANCH']).optional(),
})

const patchSchema = z.discriminatedUnion('action', [setParentSchema, detachSchema, updateMetaSchema])

export async function PATCH(req: NextRequest) {
  const session = await getSessionFromRequest(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = patchSchema.parse(await req.json())

    // Need OWNER on the child entity for all group-structure changes.
    const auth = await requireEntityAccess(req, body.entityId, 'entity:settings')
    if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

    if (body.action === 'set-parent') {
      // Reject self-parenting and cycles.
      if (body.parentEntityId === body.entityId) {
        return NextResponse.json({ error: 'An entity cannot be its own parent' }, { status: 400 })
      }
      if (await wouldCreateCycle(body.entityId, body.parentEntityId)) {
        return NextResponse.json({ error: 'This would create a circular ownership loop' }, { status: 400 })
      }

      const before = await db.legalEntity.findUnique({
        where: { id: body.entityId },
        select: { parentEntityId: true, ownershipPercent: true, acquisitionDate: true, entityType: true },
      })

      const updated = await db.legalEntity.update({
        where: { id: body.entityId },
        data: {
          parentEntityId: body.parentEntityId,
          ownershipPercent: body.ownershipPercent ?? 100,
          acquisitionDate: body.acquisitionDate ? new Date(body.acquisitionDate) : undefined,
          entityType: body.entityType ?? 'SUBSIDIARY',
        },
      })

      // Auto-mark the parent as HOLDING if it's still STANDALONE.
      await db.legalEntity.updateMany({
        where: { id: body.parentEntityId, entityType: 'STANDALONE' },
        data: { entityType: 'HOLDING' },
      })

      await logAudit({
        entityId: body.entityId,
        userId: session.userId,
        action: 'GROUP_PARENT_SET',
        resource: 'LegalEntity',
        resourceId: body.entityId,
        before, after: { parentEntityId: body.parentEntityId, ownershipPercent: body.ownershipPercent ?? 100 },
        request: req,
      })
      return NextResponse.json(updated)
    }

    if (body.action === 'detach') {
      const before = await db.legalEntity.findUnique({
        where: { id: body.entityId },
        select: { parentEntityId: true, ownershipPercent: true, entityType: true },
      })
      const updated = await db.legalEntity.update({
        where: { id: body.entityId },
        data: { parentEntityId: null, ownershipPercent: 100, entityType: 'STANDALONE' },
      })
      await logAudit({
        entityId: body.entityId, userId: session.userId,
        action: 'GROUP_DETACHED', resource: 'LegalEntity', resourceId: body.entityId,
        before, request: req,
      })
      return NextResponse.json(updated)
    }

    // update-meta — change ownership %, acquisition date, or entityType without re-parenting
    const before = await db.legalEntity.findUnique({
      where: { id: body.entityId },
      select: { ownershipPercent: true, acquisitionDate: true, entityType: true },
    })
    const updated = await db.legalEntity.update({
      where: { id: body.entityId },
      data: {
        ownershipPercent: body.ownershipPercent,
        acquisitionDate: body.acquisitionDate === null ? null : body.acquisitionDate ? new Date(body.acquisitionDate) : undefined,
        entityType: body.entityType,
      },
    })
    await logAudit({
      entityId: body.entityId, userId: session.userId,
      action: 'GROUP_META_UPDATED', resource: 'LegalEntity', resourceId: body.entityId,
      before, after: { ownershipPercent: body.ownershipPercent, acquisitionDate: body.acquisitionDate, entityType: body.entityType },
      request: req,
    })
    return NextResponse.json(updated)
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: e.errors }, { status: 400 })
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
}

/**
 * Cycle detection. If setting `entityId.parent = candidateParent` would cause
 * a loop (because candidateParent or one of its ancestors is, transitively,
 * a child of entityId), reject.
 */
async function wouldCreateCycle(entityId: string, candidateParentId: string): Promise<boolean> {
  let cursor: string | null = candidateParentId
  const seen = new Set<string>()
  while (cursor) {
    if (cursor === entityId) return true
    if (seen.has(cursor)) return true                  // existing data was already cyclic
    seen.add(cursor)
    const row: { parentEntityId: string | null } | null = await db.legalEntity.findUnique({
      where: { id: cursor },
      select: { parentEntityId: true },
    })
    cursor = row?.parentEntityId ?? null
  }
  return false
}

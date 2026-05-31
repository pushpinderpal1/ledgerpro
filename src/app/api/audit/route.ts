import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireEntityAccess } from '@/lib/auth'

/**
 * GET /api/audit
 *
 * Query parameters:
 *   entityId     (required)
 *   from, to     ISO dates — filters createdAt
 *   action       exact match (e.g. PAYMENT_VOIDED) or comma-separated list
 *   resource     exact match (e.g. JournalEntry) or comma-separated list
 *   userId       filter by who took the action
 *   search       case-insensitive substring match against resourceId
 *   page, limit  pagination (limit max 100; default 50)
 *
 * Also returns aggregate facets the UI uses for filter dropdowns:
 *   distinct actions, distinct resources, distinct users — scoped to the entity.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const entityId = sp.get('entityId')
  if (!entityId) return NextResponse.json({ error: 'entityId required' }, { status: 400 })

  const auth = await requireEntityAccess(req, entityId, 'audit:read')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const parseDate = (key: string): Date | undefined => {
    const v = sp.get(key)
    if (!v) return undefined
    const d = new Date(v)
    return isNaN(d.getTime()) ? undefined : d
  }
  const splitList = (key: string): string[] | undefined => {
    const v = sp.get(key)
    if (!v) return undefined
    const list = v.split(',').map((x) => x.trim()).filter(Boolean)
    return list.length ? list : undefined
  }

  const from = parseDate('from')
  const to = parseDate('to')
  const actions = splitList('action')
  const resources = splitList('resource')
  const userId = sp.get('userId') || undefined
  const search = sp.get('search') || undefined

  const limit = Math.min(Math.max(parseInt(sp.get('limit') ?? '50', 10) || 50, 1), 100)
  const page = Math.max(parseInt(sp.get('page') ?? '1', 10) || 1, 1)
  const skip = (page - 1) * limit

  const dateFilter: Record<string, Date> = {}
  if (from) dateFilter.gte = from
  if (to)   dateFilter.lte = to

  const where = {
    entityId,
    ...(actions ? { action: { in: actions } } : {}),
    ...(resources ? { resource: { in: resources } } : {}),
    ...(userId ? { userId } : {}),
    ...(search ? { resourceId: { contains: search, mode: 'insensitive' as const } } : {}),
    ...(from || to ? { createdAt: dateFilter } : {}),
  }

  // Page of results + total count for the paginator.
  const [rows, total] = await Promise.all([
    db.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    db.auditLog.count({ where }),
  ])

  // Resolve user emails for display, in a single query.
  const userIds = Array.from(new Set(rows.map((r) => r.userId).filter(Boolean) as string[]))
  const users = userIds.length
    ? await db.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, email: true, name: true },
      })
    : []
  const userMap = new Map(users.map((u) => [u.id, u]))

  // Facets for filter dropdowns — entity-scoped, last 90 days for performance.
  const facetCutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
  const [actionFacets, resourceFacets] = await Promise.all([
    db.auditLog.groupBy({
      by: ['action'],
      where: { entityId, createdAt: { gte: facetCutoff } },
      _count: { _all: true },
      orderBy: { _count: { action: 'desc' } },
      take: 50,
    }),
    db.auditLog.groupBy({
      by: ['resource'],
      where: { entityId, createdAt: { gte: facetCutoff } },
      _count: { _all: true },
      orderBy: { _count: { resource: 'desc' } },
      take: 50,
    }),
  ])

  return NextResponse.json({
    rows: rows.map((r) => ({
      ...r,
      user: r.userId ? userMap.get(r.userId) ?? null : null,
    })),
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
    facets: {
      actions: actionFacets.map((f) => ({ value: f.action, count: f._count._all })),
      resources: resourceFacets.map((f) => ({ value: f.resource, count: f._count._all })),
    },
  })
}

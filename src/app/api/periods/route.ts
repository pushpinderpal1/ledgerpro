import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireEntityAccess } from '@/lib/auth'
import { listLocks, lockPeriod, releaseLock } from '@/lib/periods'

// ─── GET /api/periods?entityId= ───────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const entityId = req.nextUrl.searchParams.get('entityId')
  if (!entityId) return NextResponse.json({ error: 'entityId required' }, { status: 400 })

  const auth = await requireEntityAccess(req, entityId, 'journals:read')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  return NextResponse.json({ locks: await listLocks(entityId) })
}

const lockSchema = z.object({
  entityId: z.string(),
  periodEnd: z.string(),
  reason: z.string().max(500).optional(),
})

// ─── POST /api/periods  (lock a period; requires entity:settings) ─────────────
export async function POST(req: NextRequest) {
  const body = await req.json()
  const auth = await requireEntityAccess(req, body.entityId, 'entity:settings')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const data = lockSchema.parse(body)
    const periodEnd = new Date(data.periodEnd)
    if (isNaN(periodEnd.getTime())) {
      return NextResponse.json({ error: 'Invalid periodEnd' }, { status: 400 })
    }
    const lock = await lockPeriod({
      entityId: data.entityId,
      periodEnd,
      reason: data.reason,
      lockedBy: auth.session?.userId,
    })
    return NextResponse.json(lock, { status: 201 })
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: e.errors }, { status: 400 })
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
}

// ─── PATCH /api/periods  (release a lock) ─────────────────────────────────────
export async function PATCH(req: NextRequest) {
  const body = await req.json()
  const auth = await requireEntityAccess(req, body.entityId, 'entity:settings')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const result = await releaseLock({
    id: body.id,
    entityId: body.entityId,
    releasedBy: auth.session?.userId,
  })
  if (result.count === 0) {
    return NextResponse.json({ error: 'Lock not found or already released' }, { status: 404 })
  }
  return NextResponse.json({ released: true })
}

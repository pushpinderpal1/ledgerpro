import { NextRequest, NextResponse } from 'next/server'
import { requireEntityAccess } from '@/lib/auth'
import { computeDashboard } from '@/lib/dashboard'

/**
 * GET /api/dashboard?entityId=
 *
 * Returns a single payload of dashboard KPIs (see DashboardKpis interface).
 * One round-trip is intentional so the dashboard renders fast.
 */
export async function GET(req: NextRequest) {
  const entityId = req.nextUrl.searchParams.get('entityId')
  if (!entityId) return NextResponse.json({ error: 'entityId required' }, { status: 400 })

  const auth = await requireEntityAccess(req, entityId, 'journals:read')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    return NextResponse.json(await computeDashboard(entityId))
  } catch (e) {
    console.error('[dashboard]', e)
    return NextResponse.json({ error: 'Failed to compute dashboard' }, { status: 500 })
  }
}

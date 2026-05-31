import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

/**
 * Liveness + readiness probe.
 *
 *   GET /api/health         → liveness (always 200 if the app is up)
 *   GET /api/health?deep=1  → readiness; checks DB connectivity too
 *
 * Use the deep variant for load-balancer health checks and uptime monitors.
 */
export async function GET(req: Request) {
  const url = new URL(req.url)
  const deep = url.searchParams.get('deep') === '1'

  if (!deep) {
    return NextResponse.json({ status: 'ok', timestamp: new Date().toISOString() })
  }

  try {
    // Cheap DB ping.
    await db.$queryRaw`SELECT 1`
    return NextResponse.json({
      status: 'ok',
      db: 'ok',
      timestamp: new Date().toISOString(),
    })
  } catch (e) {
    return NextResponse.json(
      {
        status: 'degraded',
        db: 'error',
        error: (e as Error).message,
        timestamp: new Date().toISOString(),
      },
      { status: 503 }
    )
  }
}

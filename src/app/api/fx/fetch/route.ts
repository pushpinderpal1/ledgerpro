import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { getSessionFromRequest } from '@/lib/auth'
import { fetchFromFrankfurter } from '@/lib/fx/fetch'
import { logAudit } from '@/lib/audit'

/**
 * POST /api/fx/fetch
 *
 * Pulls fresh FX rates from frankfurter.app (free ECB-backed service).
 * Manual rates with matching (from, to, effectiveDate) are preserved.
 *
 *   body: { base: 'USD', targets?: ['EUR','GBP',...], date?: 'YYYY-MM-DD' | 'latest' }
 *
 * OWNER access required (same gate as manual POST).
 */
const schema = z.object({
  base: z.string().length(3),
  targets: z.array(z.string().length(3)).optional(),
  date: z.union([z.literal('latest'), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).optional(),
})

async function canWriteRates(session: { userId: string; isSuperAdmin?: boolean } | null): Promise<boolean> {
  if (!session) return false
  if (session.isSuperAdmin) return true
  const owner = await db.entityAccess.count({
    where: { userId: session.userId, role: 'OWNER', isActive: true },
  })
  return owner > 0
}

export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req)
  if (!(await canWriteRates(session))) {
    return NextResponse.json({ error: 'OWNER access required to fetch FX rates' }, { status: 403 })
  }

  try {
    const body = schema.parse(await req.json())
    const result = await fetchFromFrankfurter({
      base: body.base,
      targets: body.targets,
      date: body.date,
      createdBy: session!.userId,
    })

    // Audit the bulk action. Since FX rates aren't entity-scoped but AuditLog
    // requires an entityId, we attach this to the user's first OWNER entity.
    // (Acceptable for an admin action; cleaner audit would need an entity-less
    // log table — noted in the soft-delete audit doc.)
    const ownerAccess = await db.entityAccess.findFirst({
      where: { userId: session!.userId, role: 'OWNER', isActive: true },
      select: { entityId: true },
    })
    if (ownerAccess) {
      await logAudit({
        entityId: ownerAccess.entityId,
        userId: session!.userId,
        action: 'FX_RATES_FETCHED',
        resource: 'FxRate',
        after: {
          source: result.source,
          base: result.base,
          effectiveDate: result.effectiveDate.toISOString().slice(0, 10),
          inserted: result.inserted,
          skipped: result.skipped.length,
          unsupported: result.unsupported,
        },
        request: req,
      })
    }

    return NextResponse.json(result)
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: e.errors }, { status: 400 })
    return NextResponse.json({ error: (e as Error).message }, { status: 502 })
  }
}

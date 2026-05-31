import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { getSessionFromRequest } from '@/lib/auth'
import { upsertRate, listAllRates, convertOn } from '@/lib/fx'
import { logAudit } from '@/lib/audit'

/**
 * FX rates API. Manual entry + history.
 *
 *   GET  /api/fx?from=&to=                  → list rate rows, optional pair filter
 *   GET  /api/fx?convert=1&amount=&from=&to=&date=  → preview a conversion
 *   POST /api/fx                            → upsert a manual rate
 *   DELETE /api/fx?id=                      → remove a rate row (manual cleanup)
 *
 * Rates are global (not entity-scoped). Any logged-in user can read; OWNER
 * (super-admin OR with `entity:settings` on at least one entity) can write.
 */

async function canWriteRates(req: NextRequest): Promise<boolean> {
  const session = await getSessionFromRequest(req)
  if (!session) return false
  if (session.isSuperAdmin) return true
  // Anyone who is OWNER on any entity can manage FX rates.
  const owner = await db.entityAccess.count({
    where: { userId: session.userId, role: 'OWNER', isActive: true },
  })
  return owner > 0
}

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sp = req.nextUrl.searchParams

  // Conversion preview endpoint — does not record anything.
  if (sp.get('convert') === '1') {
    const amount = parseFloat(sp.get('amount') ?? '0')
    const from = sp.get('from') ?? ''
    const to = sp.get('to') ?? ''
    const date = sp.get('date') ? new Date(sp.get('date')!) : new Date()
    if (!from || !to) return NextResponse.json({ error: 'from and to required' }, { status: 400 })
    try {
      const r = await convertOn(amount, from, to, date)
      return NextResponse.json(r)
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 404 })
    }
  }

  const from = sp.get('from') || undefined
  const to = sp.get('to') || undefined
  const rows = await listAllRates({ from, to, limit: parseInt(sp.get('limit') ?? '200', 10) })
  return NextResponse.json({ rates: rows })
}

const upsertSchema = z.object({
  fromCurrency: z.string().length(3),
  toCurrency: z.string().length(3),
  rate: z.number().positive(),
  effectiveDate: z.string(),
  source: z.string().max(100).optional(),
  notes: z.string().max(500).optional(),
})

export async function POST(req: NextRequest) {
  if (!(await canWriteRates(req))) {
    return NextResponse.json({ error: 'OWNER access required to manage FX rates' }, { status: 403 })
  }
  const session = await getSessionFromRequest(req)

  try {
    const data = upsertSchema.parse(await req.json())
    if (data.fromCurrency.toUpperCase() === data.toCurrency.toUpperCase()) {
      return NextResponse.json({ error: 'fromCurrency and toCurrency must differ' }, { status: 400 })
    }
    const rate = await upsertRate({
      fromCurrency: data.fromCurrency.toUpperCase(),
      toCurrency: data.toCurrency.toUpperCase(),
      rate: data.rate,
      effectiveDate: new Date(data.effectiveDate),
      source: data.source || 'manual',
      notes: data.notes,
      createdBy: session?.userId,
    })
    return NextResponse.json(rate, { status: 201 })
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: e.errors }, { status: 400 })
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
}

export async function DELETE(req: NextRequest) {
  if (!(await canWriteRates(req))) {
    return NextResponse.json({ error: 'OWNER access required' }, { status: 403 })
  }
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  await db.fxRate.delete({ where: { id } })
  return NextResponse.json({ deleted: true })
}

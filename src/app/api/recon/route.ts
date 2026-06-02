import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireEntityAccess } from '@/lib/auth'
import {
  startReconciliation,
  getReconciliationState,
  setLineCleared,
  autoMatch,
  finalizeReconciliation,
  parseStatement,
  previewBankAccount,
} from '@/lib/recon'

// ─── GET /api/recon ───────────────────────────────────────────────────────────
//   ?entityId=&id=                 -> live state of one reconciliation
//   ?entityId=&bankAccountId=      -> list reconciliations for an account
//   ?entityId=                     -> list all
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const entityId = searchParams.get('entityId')
  if (!entityId) return NextResponse.json({ error: 'entityId required' }, { status: 400 })

  const auth = await requireEntityAccess(req, entityId, 'recon:read')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  // Preview a bank account's transactions up to a given statement date,
  // without creating a reconciliation. Used by the Start form so the user
  // sees what's about to be reconciled before committing.
  if (searchParams.get('preview') === '1') {
    const bankAccountId = searchParams.get('bankAccountId')
    const statementDate = searchParams.get('statementDate')
    if (!bankAccountId || !statementDate) {
      return NextResponse.json({ error: 'bankAccountId and statementDate required for preview' }, { status: 400 })
    }
    try {
      return NextResponse.json(await previewBankAccount({ entityId, bankAccountId, statementDate }))
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 400 })
    }
  }

  const id = searchParams.get('id')
  if (id) {
    try {
      return NextResponse.json(await getReconciliationState(id, entityId))
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 404 })
    }
  }

  const bankAccountId = searchParams.get('bankAccountId')
  const recons = await db.bankReconciliation.findMany({
    where: { entityId, ...(bankAccountId ? { bankAccountId } : {}) },
    include: { bankAccount: { select: { code: true, name: true } } },
    orderBy: { statementDate: 'desc' },
  })
  return NextResponse.json({ reconciliations: recons })
}

const startSchema = z.object({
  entityId: z.string(),
  bankAccountId: z.string(),
  statementDate: z.string(),
  beginningBalance: z.number(),
  endingBalance: z.number(),
  statementFile: z.string().optional(),
  // raw statement text to parse (CSV or OFX), client reads the uploaded file
  statementContent: z.string().optional(),
})

// ─── POST /api/recon  (start a reconciliation, optionally with statement) ──────
export async function POST(req: NextRequest) {
  const body = await req.json()
  const auth = await requireEntityAccess(req, body.entityId, 'recon:write')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const data = startSchema.parse(body)
    let parsedLines
    if (data.statementContent) {
      parsedLines = parseStatement(data.statementFile ?? 'statement.csv', data.statementContent)
      if (parsedLines.length === 0) {
        return NextResponse.json(
          { error: 'Could not parse any transactions from the statement file' },
          { status: 400 }
        )
      }
    }
    const recon = await startReconciliation({ ...data, parsedLines })
    const state = await getReconciliationState(recon!.id, data.entityId)
    return NextResponse.json(state, { status: 201 })
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: e.errors }, { status: 400 })
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
}

// ─── PATCH /api/recon  (clear/unclear line | auto-match | finalize) ───────────
export async function PATCH(req: NextRequest) {
  const body = await req.json()
  const { entityId, action } = body
  if (!entityId || !action)
    return NextResponse.json({ error: 'entityId and action required' }, { status: 400 })

  const auth = await requireEntityAccess(req, entityId, 'recon:write')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    if (action === 'clear') {
      await setLineCleared({
        entityId,
        reconciliationId: body.reconciliationId,
        journalLineId: body.journalLineId,
        cleared: body.cleared !== false,
        clearedDate: body.clearedDate,
      })
      return NextResponse.json(await getReconciliationState(body.reconciliationId, entityId))
    }

    if (action === 'autoMatch') {
      const recon = await db.bankReconciliation.findFirst({
        where: { id: body.reconciliationId, entityId },
      })
      if (!recon) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      const result = await autoMatch(recon.id, entityId, recon.bankAccountId)
      const state = await getReconciliationState(recon.id, entityId)
      return NextResponse.json({ ...state, autoMatch: result })
    }

    if (action === 'finalize') {
      const done = await finalizeReconciliation(body.reconciliationId, entityId, auth.session?.userId)
      return NextResponse.json(done)
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
}

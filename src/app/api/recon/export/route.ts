import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireEntityAccess } from '@/lib/auth'
import { getReconciliationState } from '@/lib/recon'
import { buildReconReportData } from '@/lib/recon/report-data'
import { renderReconExcel, renderReconPdf } from '@/lib/recon/render'

/**
 * GET /api/recon/export
 *
 *   ?entityId=&id=&format=xlsx|pdf&detail=detailed|summary
 *
 * Returns the rendered report file as a binary attachment.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const entityId = sp.get('entityId')
  const id = sp.get('id')
  const format = (sp.get('format') ?? 'xlsx').toLowerCase()
  const detail = (sp.get('detail') ?? 'detailed').toLowerCase()

  if (!entityId || !id) return NextResponse.json({ error: 'entityId and id required' }, { status: 400 })
  if (format !== 'xlsx' && format !== 'pdf') return NextResponse.json({ error: 'format must be xlsx or pdf' }, { status: 400 })
  if (detail !== 'detailed' && detail !== 'summary') return NextResponse.json({ error: 'detail must be detailed or summary' }, { status: 400 })

  const auth = await requireEntityAccess(req, entityId, 'recon:read')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const state = await getReconciliationState(id, entityId) as Awaited<ReturnType<typeof getReconciliationState>> & { reconciliation: { bankAccount?: { code: string; name: string } } }
    const entity = await db.legalEntity.findUnique({ where: { id: entityId }, select: { name: true } })

    const reportInput = {
      entityName: entity?.name ?? '(Entity)',
      bankAccount: state.reconciliation.bankAccount ?? { code: '', name: '(Account)' },
      statementDate: state.reconciliation.statementDate,
      status: state.reconciliation.status as 'IN_PROGRESS' | 'COMPLETED',
      cleared: state.cleared.map(l => ({
        id: l.id,
        date: l.date,
        ref: l.ref,
        description: l.description ?? null,
        debit: l.debit,
        credit: l.credit,
        clearedStatus: l.clearedStatus,
        clearedDate: l.clearedDate,
        inThisRecon: l.inThisRecon,
      })),
      uncleared: state.uncleared.map(l => ({
        id: l.id,
        date: l.date,
        ref: l.ref,
        description: l.description ?? null,
        debit: l.debit,
        credit: l.credit,
        clearedStatus: l.clearedStatus,
        clearedDate: l.clearedDate,
        inThisRecon: l.inThisRecon,
      })),
      summary: state.summary,
    }
    const data = buildReconReportData(reportInput)

    const sdate = data.header.statementDate
    const baseName = `bank-recon-${data.header.accountCode}-${sdate}-${detail}`

    if (format === 'xlsx') {
      const buf = await renderReconExcel(data, detail as 'detailed' | 'summary')
      return new Response(buf as unknown as BodyInit, {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="${baseName}.xlsx"`,
          'Content-Length': String(buf.length),
        },
      })
    } else {
      const buf = await renderReconPdf(data, detail as 'detailed' | 'summary')
      return new Response(buf as unknown as BodyInit, {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${baseName}.pdf"`,
          'Content-Length': String(buf.length),
        },
      })
    }
  } catch (e) {
    console.error('[recon export]', e)
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

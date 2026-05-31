import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireEntityAccess } from '@/lib/auth'
import { logAudit } from '@/lib/audit'
import {
  buildPreview, classifyImport, parseImport, commitImport,
} from '@/lib/accounts/import'
import { CSV_TEMPLATE_SAMPLE } from '@/lib/accounts/import-parse'

/**
 * POST /api/accounts/import
 *
 *   { action: 'preview',  entityId, filename, content }
 *     → returns ImportPreview (parse + classify, no DB changes)
 *
 *   { action: 'commit',   entityId, filename, content, overwriteOnConflict? }
 *     → applies the import inside a transaction; returns ImportCommitResult
 *
 * GET /api/accounts/import?template=csv → returns the CSV template body
 */

const inputSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('preview'), entityId: z.string(), filename: z.string(), content: z.string().max(1_000_000) }),
  z.object({ action: z.literal('commit'),  entityId: z.string(), filename: z.string(), content: z.string().max(1_000_000), overwriteOnConflict: z.boolean().optional() }),
])

export async function GET(req: NextRequest) {
  const tpl = req.nextUrl.searchParams.get('template')
  if (tpl === 'csv') {
    return new NextResponse(CSV_TEMPLATE_SAMPLE, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': 'attachment; filename="ledgerpro-coa-template.csv"',
      },
    })
  }
  return NextResponse.json({ error: 'Unknown template' }, { status: 404 })
}

export async function POST(req: NextRequest) {
  let body
  try { body = inputSchema.parse(await req.json()) }
  catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: e.errors }, { status: 400 })
    throw e
  }

  const auth = await requireEntityAccess(req, body.entityId, 'accounts:write')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    if (body.action === 'preview') {
      const preview = await buildPreview(body.entityId, body.filename, body.content)
      return NextResponse.json(preview)
    }

    // commit
    const { format, parsed } = parseImport(body.filename, body.content)
    const classified = await classifyImport(body.entityId, parsed)
    const result = await commitImport({
      entityId: body.entityId,
      classified,
      overwriteOnConflict: body.overwriteOnConflict,
    })
    await logAudit({
      entityId: body.entityId,
      userId: auth.session?.userId,
      action: 'COA_IMPORTED',
      resource: 'Account',
      after: { format, ...result, filename: body.filename },
      request: req,
    })
    return NextResponse.json({ format, ...result })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
}

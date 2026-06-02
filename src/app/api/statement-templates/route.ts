import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireEntityAccess } from '@/lib/auth'
import { logAudit } from '@/lib/audit'
import { runStatementTemplate } from '@/lib/statement-templates'
import { validateTemplate, type StatementLine } from '@/lib/statement-templates/runner'

/**
 * /api/statement-templates
 *
 *   GET    ?entityId=                              → list templates
 *   GET    ?entityId=&id=                          → load one
 *   GET    ?entityId=&id=&run=1&from=&to=          → run and return rendered rows
 *   POST   { entityId, name, description?, lines } → create
 *   PATCH  { entityId, id, name?, description?, lines? } → update
 *   DELETE ?entityId=&id=                          → delete
 *
 * Read permission: anyone with journals:read.
 * Write permission: ACCOUNTANT or above (statement layouts affect reporting).
 */

const LINE_TYPES = ['HEADER', 'ACCOUNT', 'GROUP', 'SUBTOTAL', 'SPACER'] as const

const lineSchema = z.object({
  id: z.string(),
  type: z.enum(LINE_TYPES),
  label: z.string(),
  accountId: z.string().optional(),
  accountIds: z.array(z.string()).optional(),
  invert: z.boolean().optional(),
  bold: z.boolean().optional(),
})

const createSchema = z.object({
  entityId: z.string(),
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  lines: z.array(lineSchema).min(1),
})

const patchSchema = z.object({
  entityId: z.string(),
  id: z.string(),
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(500).nullable().optional(),
  lines: z.array(lineSchema).optional(),
})

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const entityId = sp.get('entityId')
  if (!entityId) return NextResponse.json({ error: 'entityId required' }, { status: 400 })

  const auth = await requireEntityAccess(req, entityId, 'journals:read')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const id = sp.get('id')
  const run = sp.get('run') === '1'

  if (id && run) {
    const tpl = await db.statementTemplate.findFirst({ where: { id, entityId } })
    if (!tpl) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const from = sp.get('from') ? new Date(sp.get('from')!) : undefined
    const to = sp.get('to') ? (() => { const d = new Date(sp.get('to')!); d.setHours(23,59,59,999); return d })() : undefined
    try {
      const result = await runStatementTemplate(tpl.lines as unknown as StatementLine[], { entityId, from, to })
      return NextResponse.json({
        template: { id: tpl.id, name: tpl.name, description: tpl.description },
        ...result,
      })
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 400 })
    }
  }

  if (id) {
    const tpl = await db.statementTemplate.findFirst({ where: { id, entityId } })
    if (!tpl) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json(tpl)
  }

  const templates = await db.statementTemplate.findMany({
    where: { entityId },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, description: true, createdAt: true, updatedAt: true, lines: true },
  })
  // Add a lineCount summary instead of returning all lines for the list view.
  return NextResponse.json({
    templates: templates.map(t => {
      const lineCount = Array.isArray(t.lines) ? (t.lines as unknown[]).length : 0
      const { lines: _drop, ...rest } = t
      return { ...rest, lineCount }
    }),
  })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const auth = await requireEntityAccess(req, body.entityId, 'journals:write')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const data = createSchema.parse(body)
    const errs = validateTemplate(data.lines as StatementLine[])
    if (errs.length > 0) return NextResponse.json({ error: errs.join('; ') }, { status: 400 })

    const created = await db.statementTemplate.create({
      data: {
        entityId: data.entityId,
        name: data.name,
        description: data.description,
        lines: data.lines,
      },
    })
    await logAudit({
      entityId: data.entityId, userId: auth.session?.userId,
      action: 'STATEMENT_TEMPLATE_CREATED', resource: 'StatementTemplate', resourceId: created.id,
      after: { name: created.name, lineCount: data.lines.length },
      request: req,
    })
    return NextResponse.json(created, { status: 201 })
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: e.errors }, { status: 400 })
    if ((e as { code?: string }).code === 'P2002') {
      return NextResponse.json({ error: 'A template with that name already exists' }, { status: 409 })
    }
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = patchSchema.parse(await req.json())
    const auth = await requireEntityAccess(req, body.entityId, 'journals:write')
    if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const before = await db.statementTemplate.findFirst({ where: { id: body.id, entityId: body.entityId } })
    if (!before) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    if (body.lines) {
      const errs = validateTemplate(body.lines as StatementLine[])
      if (errs.length > 0) return NextResponse.json({ error: errs.join('; ') }, { status: 400 })
    }

    const updateData: Record<string, unknown> = {}
    if (body.name !== undefined) updateData.name = body.name
    if (body.description !== undefined) updateData.description = body.description
    if (body.lines !== undefined) updateData.lines = body.lines

    const updated = await db.statementTemplate.update({
      where: { id: body.id },
      data: updateData,
    })

    await logAudit({
      entityId: body.entityId, userId: auth.session?.userId,
      action: 'STATEMENT_TEMPLATE_UPDATED', resource: 'StatementTemplate', resourceId: body.id,
      before: { name: before.name },
      after: updateData,
      request: req,
    })
    return NextResponse.json(updated)
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: e.errors }, { status: 400 })
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
}

export async function DELETE(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const entityId = sp.get('entityId'); const id = sp.get('id')
  if (!entityId || !id) return NextResponse.json({ error: 'entityId, id required' }, { status: 400 })

  const auth = await requireEntityAccess(req, entityId, 'journals:write')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const before = await db.statementTemplate.findFirst({ where: { id, entityId } })
  if (!before) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await db.statementTemplate.delete({ where: { id } })
  await logAudit({
    entityId, userId: auth.session?.userId,
    action: 'STATEMENT_TEMPLATE_DELETED', resource: 'StatementTemplate', resourceId: id,
    before: { name: before.name }, request: req,
  })
  return NextResponse.json({ deleted: true })
}

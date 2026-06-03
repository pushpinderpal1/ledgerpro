import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireEntityAccess } from '@/lib/auth'
import { logAudit } from '@/lib/audit'

/**
 * /api/attachments
 *
 *   POST   { entityId, filename, mimeType, dataBase64 }  → stores file, returns { id, filename, size }
 *   GET    ?id=&entityId=                                  → returns { filename, mimeType, dataBase64 }
 *   DELETE ?id=&entityId=                                  → removes (only if not linked to a request)
 *
 * Files are stored as bytea in Postgres. Practical limit ~5 MB per file
 * (configurable in the schema for the API body parser). For large-scale
 * deployments this should be replaced with S3/R2; for now bytea works.
 */

const MAX_BYTES = 5 * 1024 * 1024

const createSchema = z.object({
  entityId: z.string(),
  filename: z.string().min(1).max(200),
  mimeType: z.string().min(1).max(120),
  dataBase64: z.string().min(1),
  vendorId:  z.string().optional(),                // when set, attaches to a Vendor (e.g. contract upload)
})

// Helper: pick the right write permission depending on what the attachment is for.
function writePermFor(body: { vendorId?: string }) {
  return body.vendorId ? 'vendors:write' as const : 'ap-request:submit' as const
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const auth = await requireEntityAccess(req, body.entityId, writePermFor(body))
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const data = createSchema.parse(body)
    // Decode base64; reject if oversized.
    let buf: Buffer
    try {
      buf = Buffer.from(data.dataBase64, 'base64')
    } catch {
      return NextResponse.json({ error: 'Invalid base64 data' }, { status: 400 })
    }
    if (buf.length === 0) return NextResponse.json({ error: 'Empty file' }, { status: 400 })
    if (buf.length > MAX_BYTES) {
      return NextResponse.json({ error: `File too large (${buf.length} bytes; max ${MAX_BYTES})` }, { status: 413 })
    }

    // If vendorId given, validate it belongs to this entity
    if (data.vendorId) {
      const ok = await db.vendor.findFirst({ where: { id: data.vendorId, entityId: data.entityId }, select: { id: true } })
      if (!ok) return NextResponse.json({ error: 'Vendor not found in this entity' }, { status: 400 })
    }

    const created = await db.attachment.create({
      data: {
        entityId: data.entityId,
        filename: data.filename,
        mimeType: data.mimeType,
        size: buf.length,
        data: buf,
        uploadedBy: auth.session?.userId,
        vendorId: data.vendorId ?? null,
      },
      select: { id: true, filename: true, mimeType: true, size: true, createdAt: true, vendorId: true },
    })
    await logAudit({
      entityId: data.entityId, userId: auth.session?.userId,
      action: 'ATTACHMENT_UPLOADED', resource: 'Attachment', resourceId: created.id,
      after: { filename: created.filename, size: created.size, mimeType: created.mimeType },
      request: req,
    })
    return NextResponse.json(created, { status: 201 })
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: e.errors }, { status: 400 })
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const entityId = sp.get('entityId')
  const id = sp.get('id')
  if (!entityId || !id) return NextResponse.json({ error: 'entityId, id required' }, { status: 400 })

  // First peek at the attachment to decide which read permission to require.
  const peek = await db.attachment.findFirst({
    where: { id, entityId },
    select: { id: true, vendorId: true },
  })
  if (!peek) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const readPerm = peek.vendorId ? 'vendors:read' as const : 'ap:read' as const
  const auth = await requireEntityAccess(req, entityId, readPerm)
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const meta = sp.get('meta') === '1'
  const att = await db.attachment.findFirst({
    where: { id, entityId },
    select: meta
      ? { id: true, filename: true, mimeType: true, size: true, createdAt: true, vendorId: true }
      : { id: true, filename: true, mimeType: true, size: true, data: true, createdAt: true, vendorId: true },
  })
  if (!att) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (meta) return NextResponse.json(att)

  const dataBase64 = (att as { data: Buffer }).data.toString('base64')
  return NextResponse.json({
    id: att.id, filename: att.filename, mimeType: att.mimeType, size: att.size,
    dataBase64,
    vendorId: att.vendorId,
    createdAt: att.createdAt,
  })
}

export async function DELETE(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const entityId = sp.get('entityId')
  const id = sp.get('id')
  if (!entityId || !id) return NextResponse.json({ error: 'entityId, id required' }, { status: 400 })

  const peek = await db.attachment.findFirst({
    where: { id, entityId },
    select: { id: true, vendorId: true },
  })
  if (!peek) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const writePerm = peek.vendorId ? 'vendors:write' as const : 'ap-request:submit' as const
  const auth = await requireEntityAccess(req, entityId, writePerm)
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  // Refuse to delete if any ApRequest references this attachment (legacy behavior).
  const refs = await db.apRequest.count({ where: { attachmentId: id, entityId } })
  if (refs > 0) {
    return NextResponse.json({ error: `Attachment is referenced by ${refs} request(s)` }, { status: 409 })
  }
  await db.attachment.delete({ where: { id } })
  await logAudit({
    entityId, userId: auth.session?.userId,
    action: 'ATTACHMENT_DELETED', resource: 'Attachment', resourceId: id, request: req,
  })
  return NextResponse.json({ deleted: true })
}

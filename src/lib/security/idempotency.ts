import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { db } from '../db'

/**
 * Idempotency wrapper for mutating endpoints.
 *
 * Usage in a route handler:
 *   const cached = await idempotencyShortCircuit(req, entityId, userId, body)
 *   if (cached) return cached
 *   // ...do work...
 *   const res = NextResponse.json(result, { status: 201 })
 *   await idempotencyRecord(req, entityId, userId, body, result, 201)
 *   return res
 *
 * Behavior:
 *  - If no Idempotency-Key header → no caching; act normally.
 *  - If key seen before with same body hash → return the cached response.
 *  - If key seen before with a DIFFERENT body hash → 409 Conflict.
 *  - Keys are scoped per entity, so two entities can use the same key safely.
 */

const KEY_HEADER = 'idempotency-key'
// UUIDv4 (the format clients should use) — but accept any sensible token.
const KEY_FORMAT = /^[A-Za-z0-9_\-]{8,128}$/

function hashBody(body: unknown): string {
  const str = typeof body === 'string' ? body : JSON.stringify(body ?? {})
  return createHash('sha256').update(str).digest('hex')
}

export function getIdempotencyKey(req: NextRequest): string | null {
  const k = req.headers.get(KEY_HEADER)
  if (!k) return null
  if (!KEY_FORMAT.test(k)) return null
  return k
}

export async function idempotencyShortCircuit(
  req: NextRequest,
  entityId: string,
  body: unknown
): Promise<NextResponse | null> {
  const key = getIdempotencyKey(req)
  if (!key) return null

  const found = await db.idempotencyKey.findUnique({
    where: { entityId_key: { entityId, key } },
  })
  if (!found) return null

  const incomingHash = hashBody(body)
  if (found.requestHash !== incomingHash) {
    return NextResponse.json(
      { error: 'Idempotency-Key reused with a different request body' },
      { status: 409 }
    )
  }

  let parsed: unknown
  try { parsed = JSON.parse(found.responseBody) } catch { parsed = { ok: true } }
  return NextResponse.json(parsed, { status: found.responseStatus })
}

export async function idempotencyRecord(
  req: NextRequest,
  entityId: string,
  userId: string | undefined,
  body: unknown,
  response: unknown,
  status: number
): Promise<void> {
  const key = getIdempotencyKey(req)
  if (!key) return
  try {
    await db.idempotencyKey.create({
      data: {
        key,
        entityId,
        userId,
        method: req.method,
        path: req.nextUrl.pathname,
        requestHash: hashBody(body),
        responseStatus: status,
        responseBody: JSON.stringify(response),
      },
    })
  } catch {
    // Race condition: another concurrent request stored the same key first.
    // That's fine — both effectively succeeded.
  }
}

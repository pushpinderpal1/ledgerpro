import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireEntityAccess } from '@/lib/auth'
import { logAudit } from '@/lib/audit'
import {
  parseRequiredTypes,
  serializeRequiredTypes,
  MIS_DEFAULT_REQUIRED_TYPES,
  type AccountType,
} from '@/lib/mis/policy'

/**
 * /api/mis-config
 *
 *   GET   ?entityId=  → returns current MIS configuration for the entity
 *   PUT   { entityId, enabled, requiredForTypes?, allowOverride? }
 *
 * Only OWNER/ADMIN can change configuration. Read is open to anyone who can
 * read the entity (so the journal-entry form can decide whether to render the
 * MIS dropdown).
 */

const TYPES: AccountType[] = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE', 'COGS']

const putSchema = z.object({
  entityId: z.string(),
  enabled: z.boolean(),
  requiredForTypes: z.array(z.enum(TYPES as [AccountType, ...AccountType[]])).optional(),
  allowOverride: z.boolean().optional(),
})

export async function GET(req: NextRequest) {
  const entityId = req.nextUrl.searchParams.get('entityId')
  if (!entityId) return NextResponse.json({ error: 'entityId required' }, { status: 400 })

  // Read is permissive — any user with access to the entity can read its
  // MIS config so the journal form knows whether to show the dropdown.
  const auth = await requireEntityAccess(req, entityId, 'accounts:read')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const e = await db.legalEntity.findUnique({
    where: { id: entityId },
    select: { misEnabled: true, misRequiredForTypes: true, misAllowOverride: true },
  })
  if (!e) return NextResponse.json({ error: 'Entity not found' }, { status: 404 })

  return NextResponse.json({
    enabled: e.misEnabled,
    requiredForTypes: parseRequiredTypes(e.misRequiredForTypes),
    allowOverride: e.misAllowOverride,
  })
}

export async function PUT(req: NextRequest) {
  const body = await req.json()
  const auth = await requireEntityAccess(req, body.entityId, 'entity:settings')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const data = putSchema.parse(body)
    const before = await db.legalEntity.findUnique({
      where: { id: data.entityId },
      select: { misEnabled: true, misRequiredForTypes: true, misAllowOverride: true },
    })
    if (!before) return NextResponse.json({ error: 'Entity not found' }, { status: 404 })

    // If enabling for the first time with no explicit requiredForTypes, seed
    // sensible defaults so the user gets useful behavior out of the gate.
    let requiredForTypes = data.requiredForTypes
    if (data.enabled && !before.misEnabled && (!requiredForTypes || requiredForTypes.length === 0)) {
      requiredForTypes = MIS_DEFAULT_REQUIRED_TYPES
    }

    const updated = await db.legalEntity.update({
      where: { id: data.entityId },
      data: {
        misEnabled: data.enabled,
        ...(requiredForTypes !== undefined ? { misRequiredForTypes: serializeRequiredTypes(requiredForTypes) } : {}),
        ...(data.allowOverride !== undefined ? { misAllowOverride: data.allowOverride } : {}),
      },
      select: { misEnabled: true, misRequiredForTypes: true, misAllowOverride: true },
    })

    await logAudit({
      entityId: data.entityId,
      userId: auth.session?.userId,
      action: 'MIS_CONFIG_UPDATED',
      resource: 'LegalEntity',
      resourceId: data.entityId,
      before,
      after: updated,
      request: req,
    })

    return NextResponse.json({
      enabled: updated.misEnabled,
      requiredForTypes: parseRequiredTypes(updated.misRequiredForTypes),
      allowOverride: updated.misAllowOverride,
    })
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: e.errors }, { status: 400 })
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
}

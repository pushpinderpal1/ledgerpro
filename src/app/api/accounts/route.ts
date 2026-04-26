import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireEntityAccess } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const entityId = req.nextUrl.searchParams.get('entityId')
  if (!entityId) return NextResponse.json({ error: 'entityId required' }, { status: 400 })
  const auth = await requireEntityAccess(req, entityId, 'accounts:read')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const accounts = await db.account.findMany({
    where: { entityId, isActive: true },
    orderBy: [{ type: 'asc' }, { code: 'asc' }],
  })
  return NextResponse.json(accounts)
}

const schema = z.object({
  entityId: z.string(),
  code: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(['ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE','COGS']),
  subType: z.string().optional(),
  description: z.string().optional(),
  parentId: z.string().optional(),
  isBankAccount: z.boolean().optional(),
  taxCode: z.string().optional(),
})

export async function POST(req: NextRequest) {
  const body = await req.json()
  const auth = await requireEntityAccess(req, body.entityId, 'accounts:write')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  try {
    const data = schema.parse(body)
    const account = await db.account.create({ data })
    return NextResponse.json(account, { status: 201 })
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: e.errors }, { status: 400 })
    if ((e as {code?:string}).code === 'P2002') return NextResponse.json({ error: 'Account code already exists' }, { status: 409 })
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  const body = await req.json()
  const { entityId, id, ...updates } = body
  const auth = await requireEntityAccess(req, entityId, 'accounts:write')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const account = await db.account.update({ where: { id }, data: updates })
  return NextResponse.json(account)
}

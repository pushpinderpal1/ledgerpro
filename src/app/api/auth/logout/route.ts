import { NextRequest, NextResponse } from 'next/server'
import { clearSessionCookie, getSessionFromRequest } from '@/lib/auth'
import { db } from '@/lib/db'

export async function POST(req: NextRequest) {
  const res = NextResponse.json({ success: true })
  clearSessionCookie(res)
  return res
}

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = await db.user.findUnique({
    where: { id: session.userId },
    select: { id: true, name: true, email: true, isSuperAdmin: true, lastLoginAt: true },
  })
  return NextResponse.json(user)
}

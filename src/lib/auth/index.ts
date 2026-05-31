import { SignJWT, jwtVerify } from 'jose'
import bcrypt from 'bcryptjs'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '../db'
import { EntityRole } from '@prisma/client'

const SECRET = new TextEncoder().encode(process.env.JWT_SECRET!)
const COOKIE = 'ledgerpro_session'

export interface SessionPayload {
  userId: string
  email: string
  name: string
  isSuperAdmin: boolean
  currentEntityId?: string
}

// ─── Token helpers ────────────────────────────────────────────────────────────

export async function signToken(payload: SessionPayload): Promise<string> {
  return new SignJWT(payload as Record<string, unknown>)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(process.env.JWT_EXPIRES_IN ?? '7d')
    .sign(SECRET)
}

export async function verifyToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, SECRET)
    return payload as unknown as SessionPayload
  } catch {
    return null
  }
}

// ─── 2FA challenge tokens ────────────────────────────────────────────────────
// Short-lived (5 min) token issued after password check when 2FA is required.
// Carries only the user id and a marker; cannot be used as a session cookie.

export interface ChallengePayload {
  userId: string
  challenge: '2fa'
}

export async function signChallengeToken(userId: string): Promise<string> {
  return new SignJWT({ userId, challenge: '2fa' } as Record<string, unknown>)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(SECRET)
}

export async function verifyChallengeToken(token: string): Promise<ChallengePayload | null> {
  try {
    const { payload } = await jwtVerify(token, SECRET)
    if ((payload as { challenge?: string }).challenge !== '2fa') return null
    return payload as unknown as ChallengePayload
  } catch {
    return null
  }
}

// ─── Cookie helpers ───────────────────────────────────────────────────────────

export async function getSession(): Promise<SessionPayload | null> {
  const token = cookies().get(COOKIE)?.value
  if (!token) return null
  return verifyToken(token)
}

export function setSessionCookie(res: NextResponse, token: string) {
  res.cookies.set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 60 * 60 * 24 * 7,
    path: '/',
  })
}

export function clearSessionCookie(res: NextResponse) {
  res.cookies.delete(COOKIE)
}

// ─── Password ─────────────────────────────────────────────────────────────────

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12)
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

// ─── Access control ───────────────────────────────────────────────────────────

const ROLE_HIERARCHY: Record<EntityRole, number> = {
  OWNER: 100,
  ADMIN: 80,
  ACCOUNTANT: 60,
  AUDITOR: 40,
  AP_CLERK: 30,
  PAYROLL_CLERK: 30,
  CLIENT_VIEW: 10,
}

export function hasRole(userRole: EntityRole, requiredRole: EntityRole): boolean {
  return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[requiredRole]
}

// Module-level permission map
export const MODULE_PERMISSIONS: Record<string, EntityRole> = {
  'accounts:read':   'CLIENT_VIEW',
  'accounts:write':  'ACCOUNTANT',
  'journals:read':   'AUDITOR',
  'journals:write':  'ACCOUNTANT',
  'ap:read':         'AP_CLERK',
  'ap:write':        'AP_CLERK',
  'payments:read':   'AP_CLERK',
  'payments:write':  'ACCOUNTANT',
  'recon:read':      'AUDITOR',
  'recon:write':     'ACCOUNTANT',
  'assets:read':     'AUDITOR',
  'assets:write':    'ACCOUNTANT',
  'payroll:read':    'PAYROLL_CLERK',
  'payroll:write':   'PAYROLL_CLERK',
  'budget:read':     'AUDITOR',
  'budget:write':    'ACCOUNTANT',
  'users:read':      'ADMIN',
  'users:write':     'ADMIN',
  'audit:read':      'AUDITOR',
  'entity:settings': 'OWNER',
}

export async function getEntityAccess(userId: string, entityId: string) {
  return db.entityAccess.findUnique({
    where: { userId_entityId: { userId, entityId } },
  })
}

export async function requireEntityAccess(
  req: NextRequest,
  entityId: string,
  permission?: string
) {
  const session = await getSessionFromRequest(req)
  if (!session) return { error: 'Unauthorized', status: 401 }

  if (session.isSuperAdmin) return { session, role: 'OWNER' as EntityRole }

  const access = await getEntityAccess(session.userId, entityId)
  if (!access || !access.isActive) return { error: 'Access denied', status: 403 }

  if (permission) {
    const required = MODULE_PERMISSIONS[permission]
    if (required && !hasRole(access.role, required)) {
      return { error: `Requires ${required} role`, status: 403 }
    }
  }

  return { session, role: access.role }
}

export async function getSessionFromRequest(req: NextRequest): Promise<SessionPayload | null> {
  const token = req.cookies.get(COOKIE)?.value
  if (!token) return null
  return verifyToken(token)
}

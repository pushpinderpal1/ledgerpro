import { db } from '../db'
import type { NextRequest } from 'next/server'

/**
 * Audit-log helper. Centralizes how we write to `AuditLog` so every call site
 * gets consistent shape + sensitive-field redaction.
 *
 * Behavior:
 *  - Never throws. Audit logging failure must not break the originating op.
 *  - Sanitizes known-sensitive keys before persisting (password, secrets, ACH).
 *  - Truncates oversized values so a single bad call can't blow the row size.
 *  - Captures IP from forwarded headers when available.
 *
 * Action names are short uppercase verbs joined with the resource:
 *   JOURNAL_POSTED, PAYMENT_VOIDED, PERIOD_LOCKED, ENTITY_CREATED, etc.
 */

// Keys we always scrub from logged values. Match by lowercase substring.
const SENSITIVE_KEYS = [
  'password', 'passwordhash', 'secret', 'token', 'apikey', 'api_key',
  'totpsecret', 'jwt', 'sessiontoken', 'achaccountno', 'routingno',
  'codehash', 'backupcode',
]

const MAX_VALUE_LEN = 4000  // ample for typical records; protects against bloat

export interface AuditInput {
  entityId: string
  userId?: string | null
  action: string
  resource: string
  resourceId?: string | null
  before?: unknown                   // snapshot before change (optional)
  after?: unknown                    // snapshot after change (optional)
  request?: NextRequest | Request    // for IP extraction
}

export async function logAudit(input: AuditInput): Promise<void> {
  try {
    const ipAddress = input.request ? extractIp(input.request) : null
    const oldValue = input.before !== undefined ? serializeSafe(input.before) : null
    const newValue = input.after !== undefined ? serializeSafe(input.after) : null

    await db.auditLog.create({
      data: {
        entityId: input.entityId,
        userId: input.userId ?? null,
        action: input.action,
        resource: input.resource,
        resourceId: input.resourceId ?? null,
        oldValue,
        newValue,
        ipAddress,
      },
    })
  } catch (e) {
    // Never let an audit failure cascade. Surface to logs for ops to see.
    console.error('[audit] failed to log:', e)
  }
}

/** Convenience for create operations: only `after` is recorded. */
export const logCreate = (i: Omit<AuditInput, 'before'> & { after?: unknown }) => logAudit(i)

/** Convenience for delete/void operations: only `before` is recorded. */
export const logDelete = (i: Omit<AuditInput, 'after'> & { before?: unknown }) => logAudit(i)

// ─── Internals ────────────────────────────────────────────────────────────────

function extractIp(req: NextRequest | Request): string | null {
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0]!.trim()
  const real = req.headers.get('x-real-ip')
  if (real) return real
  return null
}

/**
 * Recursive serializer that:
 *  - Replaces values for sensitive keys with "[redacted]"
 *  - Stringifies BigInt and Date safely
 *  - Caps output length to MAX_VALUE_LEN
 */
function serializeSafe(value: unknown): string {
  const sanitized = sanitize(value)
  let json: string
  try {
    json = JSON.stringify(sanitized)
  } catch {
    json = String(sanitized)
  }
  if (json.length > MAX_VALUE_LEN) json = json.slice(0, MAX_VALUE_LEN - 12) + '…[truncated]'
  return json
}

function isSensitiveKey(key: string): boolean {
  const k = key.toLowerCase()
  return SENSITIVE_KEYS.some((s) => k.includes(s))
}

function sanitize(value: unknown, depth: number = 0): unknown {
  if (depth > 5) return '[too deep]'                          // bound recursion
  if (value == null) return value
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map((v) => sanitize(v, depth + 1))
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (isSensitiveKey(k)) out[k] = '[redacted]'
      else out[k] = sanitize(v, depth + 1)
    }
    return out
  }
  return value
}

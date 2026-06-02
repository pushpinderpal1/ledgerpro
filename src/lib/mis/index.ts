import { db } from '../db'
import { parseRequiredTypes, validateLines, type MisPolicy, type AccountType, type ValidationIssue } from './policy'

/**
 * DB-backed MIS engine. Wraps the entity's stored config into a MisPolicy
 * and offers helpers used by API routes and journal-posting logic.
 */

export async function getEntityPolicy(entityId: string): Promise<MisPolicy> {
  const e = await db.legalEntity.findUnique({
    where: { id: entityId },
    select: { misEnabled: true, misRequiredForTypes: true, misAllowOverride: true },
  })
  if (!e) throw new Error('Entity not found')
  return {
    enabled: e.misEnabled,
    requiredForTypes: parseRequiredTypes(e.misRequiredForTypes),
    allowOverride: e.misAllowOverride,
  }
}

/**
 * Load each line's account type and join with its current misCodeId, then
 * run the pure validator. Returns blocking issues only when the policy is
 * strict; warnings are surfaced so the UI can ask the user to confirm.
 *
 * Lines parameter is the shape used in posting routes (raw incoming).
 */
export async function validatePostingLines(
  entityId: string,
  lines: Array<{ accountId: string; misCodeId?: string | null; lineOrder?: number }>,
): Promise<ValidationIssue[]> {
  const policy = await getEntityPolicy(entityId)
  if (!policy.enabled) return []

  // Resolve account types for the lines.
  const accountIds = [...new Set(lines.map(l => l.accountId))]
  const accounts = await db.account.findMany({
    where: { id: { in: accountIds }, entityId },
    select: { id: true, type: true },
  })
  const typeById = new Map<string, AccountType>(accounts.map(a => [a.id, a.type as AccountType]))

  const enriched = lines.map(l => ({
    accountType: typeById.get(l.accountId) ?? 'ASSET' as AccountType,
    misCodeId: l.misCodeId ?? null,
    lineOrder: l.lineOrder,
  }))

  // If any MIS code is referenced, verify it belongs to this entity and is active.
  // Lines that fail this become extra errors regardless of policy strictness.
  const referencedIds = lines.map(l => l.misCodeId).filter((x): x is string => !!x)
  let extra: ValidationIssue[] = []
  if (referencedIds.length > 0) {
    const valid = await db.misCode.findMany({
      where: { id: { in: referencedIds }, entityId, isActive: true },
      select: { id: true },
    })
    const validIds = new Set(valid.map(v => v.id))
    extra = lines
      .filter(l => l.misCodeId && !validIds.has(l.misCodeId))
      .map(l => ({
        lineOrder: l.lineOrder,
        accountType: (typeById.get(l.accountId) ?? 'ASSET') as AccountType,
        severity: 'error' as const,
        message: `Line ${l.lineOrder ?? '?'} references an MIS code that doesn't belong to this entity or is inactive`,
      }))
  }

  return [...validateLines(policy, enriched), ...extra]
}

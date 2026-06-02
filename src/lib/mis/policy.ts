/**
 * MIS policy — pure logic. No DB dependency.
 *
 * The validation rules live here so they can be unit-tested without a
 * database, and so the DB-backed engine and any future UI client can share
 * the same code.
 *
 * Two-layer policy:
 *   Layer 1: entity.misEnabled        → master toggle
 *   Layer 2: entity.misRequiredForTypes  → CSV of AccountType codes; lines
 *                                         that touch one of these account
 *                                         types must carry an MIS code
 *   Layer 3: entity.misAllowOverride  → escape hatch. When true, the
 *                                         requirement is downgraded to
 *                                         "encouraged but not required."
 */

export type AccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE' | 'COGS'

export interface MisPolicy {
  enabled: boolean
  requiredForTypes: AccountType[]
  allowOverride: boolean
}

export interface LineForValidation {
  accountType: AccountType
  misCodeId: string | null
  lineOrder?: number
}

export interface ValidationIssue {
  lineOrder?: number
  accountType: AccountType
  severity: 'error' | 'warning'
  message: string
}

/** Parse the comma-separated `requiredForTypes` string stored on LegalEntity. */
export function parseRequiredTypes(csv: string): AccountType[] {
  if (!csv) return []
  const all: AccountType[] = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE', 'COGS']
  return csv
    .split(',')
    .map(s => s.trim().toUpperCase())
    .filter(s => (all as string[]).includes(s)) as AccountType[]
}

/** Inverse — serializes a list back to CSV for storage. */
export function serializeRequiredTypes(types: AccountType[]): string {
  return [...new Set(types)].join(',')
}

/**
 * Given an entity's MIS policy and the journal lines being posted,
 * return the validation issues. An empty array means "OK to post."
 *
 * - When MIS is disabled, returns [] regardless of misCodeId values.
 * - When allowOverride is true, a missing MIS code on a required line
 *   becomes a warning (not blocking) so the UI can surface it.
 */
export function validateLines(policy: MisPolicy, lines: LineForValidation[]): ValidationIssue[] {
  if (!policy.enabled) return []

  const required = new Set(policy.requiredForTypes)
  if (required.size === 0) return []

  const issues: ValidationIssue[] = []
  for (const line of lines) {
    if (!required.has(line.accountType)) continue
    if (line.misCodeId && line.misCodeId.trim().length > 0) continue
    issues.push({
      lineOrder: line.lineOrder,
      accountType: line.accountType,
      severity: policy.allowOverride ? 'warning' : 'error',
      message: policy.allowOverride
        ? `Line ${line.lineOrder ?? '?'} (${line.accountType}) is missing an MIS code — proceed?`
        : `Line ${line.lineOrder ?? '?'} (${line.accountType}) requires an MIS code`,
    })
  }
  return issues
}

/** True when the policy means MIS field should appear on the posting form. */
export function shouldShowMisField(policy: MisPolicy): boolean {
  return policy.enabled
}

/** True when an MIS field on a specific account type is required (blocking). */
export function isMisRequiredFor(policy: MisPolicy, type: AccountType): boolean {
  if (!policy.enabled) return false
  if (policy.allowOverride) return false
  return policy.requiredForTypes.includes(type)
}

/** Defaults applied the first time an entity enables MIS. */
export const MIS_DEFAULT_REQUIRED_TYPES: AccountType[] = ['EXPENSE', 'REVENUE', 'COGS']

/** Suggested soft cap on the master list — for warning, not blocking. */
export const MIS_SOFT_CODE_CAP = 10

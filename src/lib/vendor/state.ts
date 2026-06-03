/**
 * Pure state machine for the Vendor Master approval workflow.
 *
 * Transitions (no DB, no time, no auth — those are caller responsibilities):
 *
 *   [created]      → PENDING_APPROVAL   (submit / initial create)
 *   PENDING        → APPROVED           (action: 'approve')
 *   PENDING        → REJECTED           (action: 'reject', reason required)
 *   REJECTED       → PENDING_APPROVAL   (action: 'resubmit', after editor fixes)
 *   APPROVED       → INACTIVE           (action: 'archive')
 *   INACTIVE       → APPROVED           (action: 'reactivate')
 *
 * Same-user-cannot-approve-own is a separate concern (see canActUpon).
 */

export type VendorStatus = 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'INACTIVE'
export type VendorAction = 'approve' | 'reject' | 'resubmit' | 'archive' | 'reactivate'

export interface TransitionInput {
  currentStatus: VendorStatus
  action: VendorAction
  actor:    { userId?: string | null }
  submittedBy?: string | null            // user who created/last submitted
  reason?: string                         // required for 'reject'
}

export interface TransitionResult {
  ok: true
  nextStatus: VendorStatus
  approvedFields:  { approvedBy?: string;  approvedAt?: Date }
  rejectedFields:  { rejectedBy?: string;  rejectedAt?: Date;  rejectionReason?: string }
  submittedFields: { submittedBy?: string; submittedAt?: Date }
}

export type TransitionError = {
  ok: false
  error: string
  code: 'invalid_transition' | 'reason_required' | 'self_approve' | 'unauthorized'
}

/**
 * Returns true if `actor` may act on a vendor that was submitted by `submittedBy`.
 * Same-user-cannot-approve-own — only relevant for 'approve' and 'reject'.
 */
export function canActUpon(action: VendorAction, actorUserId: string | undefined | null, submittedBy: string | undefined | null): boolean {
  if (action !== 'approve' && action !== 'reject') return true
  if (!actorUserId || !submittedBy) return true     // permissive when identity not known
  return actorUserId !== submittedBy
}

const TRANSITIONS: Record<VendorStatus, Partial<Record<VendorAction, VendorStatus>>> = {
  PENDING_APPROVAL: { approve: 'APPROVED', reject: 'REJECTED' },
  APPROVED:         { archive: 'INACTIVE' },
  REJECTED:         { resubmit: 'PENDING_APPROVAL' },
  INACTIVE:         { reactivate: 'APPROVED' },
}

export function applyTransition(input: TransitionInput): TransitionResult | TransitionError {
  const { currentStatus, action, actor, submittedBy, reason } = input

  const next = TRANSITIONS[currentStatus]?.[action]
  if (!next) {
    return {
      ok: false,
      error: `Cannot ${action} a vendor in status ${currentStatus}`,
      code: 'invalid_transition',
    }
  }

  if (action === 'reject' && (!reason || !reason.trim())) {
    return { ok: false, error: 'Rejection reason is required', code: 'reason_required' }
  }

  if ((action === 'approve' || action === 'reject') && !canActUpon(action, actor.userId, submittedBy)) {
    return {
      ok: false,
      error: 'You cannot approve or reject a vendor you submitted yourself',
      code: 'self_approve',
    }
  }

  const now = new Date()
  const approvedFields:  TransitionResult['approvedFields']  = {}
  const rejectedFields:  TransitionResult['rejectedFields']  = {}
  const submittedFields: TransitionResult['submittedFields'] = {}

  if (action === 'approve') {
    approvedFields.approvedBy = actor.userId ?? undefined
    approvedFields.approvedAt = now
  } else if (action === 'reject') {
    rejectedFields.rejectedBy = actor.userId ?? undefined
    rejectedFields.rejectedAt = now
    rejectedFields.rejectionReason = reason!.trim()
  } else if (action === 'resubmit') {
    submittedFields.submittedBy = actor.userId ?? undefined
    submittedFields.submittedAt = now
  }

  return { ok: true, nextStatus: next, approvedFields, rejectedFields, submittedFields }
}

export function frequencyDisplay(f: string): string {
  const lookup: Record<string, string> = {
    ON_DEMAND:   'On Demand',
    DAILY:       'Daily',
    WEEKLY:      'Weekly',
    MONTHLY:     'Monthly',
    QUARTERLY:   'Quarterly',
    SEMI_ANNUAL: 'Semi-Annual',
    ANNUAL:      'Annual',
    STATUTORY:   'Statutory',
    ONE_TIME:    'One-Time',
    OTHER:       'Other',
  }
  return lookup[f] ?? f
}

export const ALL_FREQUENCIES = [
  'ON_DEMAND', 'DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY',
  'SEMI_ANNUAL', 'ANNUAL', 'STATUTORY', 'ONE_TIME', 'OTHER',
] as const

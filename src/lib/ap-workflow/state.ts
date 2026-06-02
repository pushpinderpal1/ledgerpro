/**
 * AP Workflow state machine — pure logic, no DB.
 *
 * States and transitions:
 *
 *   ┌──────────────┐  approve  ┌──────────┐  post   ┌─────────┐
 *   │  SUBMITTED   │ ────────> │ APPROVED │ ──────> │ POSTED  │
 *   └──────────────┘           └──────────┘         └─────────┘
 *           │                       │  │
 *   return  │                  ret  │  │ ret
 *   to req  │                  to a │  │ to req
 *           ▼                       ▼  │
 *   ┌──────────────────┐   ┌─────────────────┐
 *   │ RETURNED_TO_     │   │ RETURNED_TO_    │
 *   │   REQUESTER      │   │   APPROVER      │
 *   └──────────────────┘   └─────────────────┘
 *           │ resubmit              │ approve
 *           └─> SUBMITTED           └─> APPROVED
 *
 * Terminal state: POSTED. A posted request cannot be modified — it must be
 * voided through a reversing journal entry like any other posted document.
 */

export type ApRequestStatus =
  | 'SUBMITTED'
  | 'APPROVED'
  | 'POSTED'
  | 'RETURNED_TO_REQUESTER'
  | 'RETURNED_TO_APPROVER'

export type WorkflowAction =
  | 'submit'           // create or resubmit a SUBMITTED → SUBMITTED
  | 'approve'          // SUBMITTED or RETURNED_TO_APPROVER → APPROVED
  | 'return-to-requester'  // SUBMITTED or APPROVED → RETURNED_TO_REQUESTER
  | 'return-to-approver'   // APPROVED → RETURNED_TO_APPROVER (from accountant)
  | 'post'             // APPROVED → POSTED
  | 'resubmit'         // RETURNED_TO_REQUESTER → SUBMITTED
  | 'delete'           // RETURNED_TO_REQUESTER (own) or SUBMITTED (own, before approval)

export interface ActorContext {
  role: 'OWNER' | 'ADMIN' | 'ACCOUNTANT' | 'AUDITOR' | 'AP_CLERK' | 'PAYROLL_CLERK' | 'CLIENT_VIEW'
  userId: string
  isRequester: boolean    // is this user the requester of the request?
}

/** Returns the actions a user can take on a request in a given status. */
export function allowedActions(status: ApRequestStatus, actor: ActorContext): WorkflowAction[] {
  const canApprove = actor.role === 'OWNER' || actor.role === 'ADMIN'
  const canPost = canApprove || actor.role === 'ACCOUNTANT'
  const out: WorkflowAction[] = []

  switch (status) {
    case 'SUBMITTED':
      if (canApprove) {
        out.push('approve', 'return-to-requester')
      }
      // Requester can delete their own pre-approval requests.
      if (actor.isRequester) out.push('delete')
      break

    case 'APPROVED':
      if (canPost) {
        out.push('post', 'return-to-approver', 'return-to-requester')
      }
      break

    case 'POSTED':
      // Terminal — no actions.
      break

    case 'RETURNED_TO_REQUESTER':
      if (actor.isRequester) out.push('resubmit', 'delete')
      break

    case 'RETURNED_TO_APPROVER':
      if (canApprove) out.push('approve', 'return-to-requester')
      break
  }
  return out
}

/** Apply a workflow action. Returns the next status, or throws on invalid. */
export function applyAction(
  current: ApRequestStatus,
  action: WorkflowAction,
  actor: ActorContext,
): ApRequestStatus {
  if (!allowedActions(current, actor).includes(action)) {
    throw new Error(`Action '${action}' not allowed from status '${current}' for role '${actor.role}' (isRequester=${actor.isRequester})`)
  }
  switch (action) {
    case 'submit':
    case 'resubmit':
      return 'SUBMITTED'
    case 'approve':
      return 'APPROVED'
    case 'return-to-requester':
      return 'RETURNED_TO_REQUESTER'
    case 'return-to-approver':
      return 'RETURNED_TO_APPROVER'
    case 'post':
      return 'POSTED'
    case 'delete':
      return current   // delete is a tombstone — handled at the API layer
    default: {
      const _exhaustive: never = action
      throw new Error(`Unknown action: ${_exhaustive}`)
    }
  }
}

/** Audit-log friendly action name (what we store in ApRequestComment.action) */
export function actionAuditName(action: WorkflowAction): string {
  return {
    submit: 'SUBMITTED',
    approve: 'APPROVED',
    'return-to-requester': 'RETURNED_TO_REQUESTER',
    'return-to-approver': 'RETURNED_TO_APPROVER',
    post: 'POSTED',
    resubmit: 'RESUBMITTED',
    delete: 'DELETED',
  }[action]
}

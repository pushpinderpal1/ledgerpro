import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyTransition, canActUpon, frequencyDisplay, ALL_FREQUENCIES } from '../src/lib/vendor/state'

const actor = (userId: string | null = 'approver-1') => ({ userId })

test('PENDING → APPROVED on approve action', () => {
  const r = applyTransition({
    currentStatus: 'PENDING_APPROVAL',
    action: 'approve',
    actor: actor('u-approver'),
    submittedBy: 'u-clerk',
  })
  assert.equal(r.ok, true)
  if (r.ok) {
    assert.equal(r.nextStatus, 'APPROVED')
    assert.equal(r.approvedFields.approvedBy, 'u-approver')
    assert.ok(r.approvedFields.approvedAt instanceof Date)
  }
})

test('PENDING → REJECTED with reason', () => {
  const r = applyTransition({
    currentStatus: 'PENDING_APPROVAL',
    action: 'reject',
    actor: actor('u-approver'),
    submittedBy: 'u-clerk',
    reason: 'Missing tax documents',
  })
  assert.equal(r.ok, true)
  if (r.ok) {
    assert.equal(r.nextStatus, 'REJECTED')
    assert.equal(r.rejectedFields.rejectionReason, 'Missing tax documents')
  }
})

test('Reject without reason → error', () => {
  const r = applyTransition({
    currentStatus: 'PENDING_APPROVAL',
    action: 'reject',
    actor: actor('u-approver'),
    submittedBy: 'u-clerk',
  })
  assert.equal(r.ok, false)
  if (!r.ok) {
    assert.equal(r.code, 'reason_required')
  }
})

test('Reject with whitespace-only reason → error', () => {
  const r = applyTransition({
    currentStatus: 'PENDING_APPROVAL',
    action: 'reject',
    actor: actor('u-approver'),
    submittedBy: 'u-clerk',
    reason: '   ',
  })
  assert.equal(r.ok, false)
})

test('Same-user-cannot-approve-own on approve', () => {
  const r = applyTransition({
    currentStatus: 'PENDING_APPROVAL',
    action: 'approve',
    actor: actor('u-clerk'),       // same as submittedBy
    submittedBy: 'u-clerk',
  })
  assert.equal(r.ok, false)
  if (!r.ok) {
    assert.equal(r.code, 'self_approve')
  }
})

test('Same-user-cannot-approve-own on reject', () => {
  const r = applyTransition({
    currentStatus: 'PENDING_APPROVAL',
    action: 'reject',
    actor: actor('u-clerk'),
    submittedBy: 'u-clerk',
    reason: 'oops',
  })
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.code, 'self_approve')
})

test('Same-user CAN resubmit own rejected vendor', () => {
  // The clerk who created the rejected vendor can fix it and resubmit
  const r = applyTransition({
    currentStatus: 'REJECTED',
    action: 'resubmit',
    actor: actor('u-clerk'),
    submittedBy: 'u-clerk',
  })
  assert.equal(r.ok, true)
  if (r.ok) {
    assert.equal(r.nextStatus, 'PENDING_APPROVAL')
    assert.equal(r.submittedFields.submittedBy, 'u-clerk')
  }
})

test('APPROVED → INACTIVE on archive', () => {
  const r = applyTransition({
    currentStatus: 'APPROVED',
    action: 'archive',
    actor: actor('u-admin'),
    submittedBy: 'u-clerk',
  })
  assert.equal(r.ok, true)
  if (r.ok) assert.equal(r.nextStatus, 'INACTIVE')
})

test('INACTIVE → APPROVED on reactivate (no re-approval)', () => {
  const r = applyTransition({
    currentStatus: 'INACTIVE',
    action: 'reactivate',
    actor: actor('u-admin'),
    submittedBy: 'u-clerk',
  })
  assert.equal(r.ok, true)
  if (r.ok) assert.equal(r.nextStatus, 'APPROVED')
})

test('Cannot approve APPROVED, cannot reject INACTIVE, etc.', () => {
  for (const bad of [
    { currentStatus: 'APPROVED', action: 'approve' },
    { currentStatus: 'INACTIVE', action: 'reject' },
    { currentStatus: 'APPROVED', action: 'resubmit' },
    { currentStatus: 'PENDING_APPROVAL', action: 'archive' },
    { currentStatus: 'PENDING_APPROVAL', action: 'reactivate' },
  ] as const) {
    const r = applyTransition({
      currentStatus: bad.currentStatus,
      action: bad.action,
      actor: actor('u'),
      submittedBy: 's',
      reason: 'x',
    })
    assert.equal(r.ok, false, `Expected error for ${bad.currentStatus} + ${bad.action}`)
    if (!r.ok) assert.equal(r.code, 'invalid_transition')
  }
})

test('canActUpon: approve/reject blocked when actor === submitter', () => {
  assert.equal(canActUpon('approve', 'u1', 'u1'), false)
  assert.equal(canActUpon('reject',  'u1', 'u1'), false)
  assert.equal(canActUpon('approve', 'u1', 'u2'), true)
  // Other actions always allowed
  assert.equal(canActUpon('resubmit',   'u1', 'u1'), true)
  assert.equal(canActUpon('archive',    'u1', 'u1'), true)
  assert.equal(canActUpon('reactivate', 'u1', 'u1'), true)
})

test('canActUpon: permissive when identity unknown', () => {
  assert.equal(canActUpon('approve', null, 'u1'), true)
  assert.equal(canActUpon('approve', 'u1', null), true)
})

test('frequencyDisplay maps all enum values', () => {
  for (const f of ALL_FREQUENCIES) {
    const out = frequencyDisplay(f)
    assert.ok(out.length > 0)
    assert.ok(!out.includes('_'), `${f} → ${out} should not contain underscores`)
  }
})

test('frequencyDisplay falls through for unknown values', () => {
  assert.equal(frequencyDisplay('UNKNOWN'), 'UNKNOWN')
})

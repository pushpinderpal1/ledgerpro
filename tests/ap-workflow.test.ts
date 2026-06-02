import { test } from 'node:test'
import assert from 'node:assert/strict'
import { allowedActions, applyAction, type ActorContext } from '../src/lib/ap-workflow/state'

const requester: ActorContext = { role: 'AP_CLERK', userId: 'u1', isRequester: true }
const otherUser: ActorContext = { role: 'AP_CLERK', userId: 'u2', isRequester: false }
const approver:  ActorContext = { role: 'ADMIN',    userId: 'u3', isRequester: false }
const accountant:ActorContext = { role: 'ACCOUNTANT', userId: 'u4', isRequester: false }
const auditor:   ActorContext = { role: 'AUDITOR',   userId: 'u5', isRequester: false }

test('SUBMITTED: requester can delete own, approver can approve/return', () => {
  assert.deepEqual(allowedActions('SUBMITTED', requester).sort(), ['delete'])
  assert.deepEqual(allowedActions('SUBMITTED', otherUser), [])
  assert.deepEqual(allowedActions('SUBMITTED', approver).sort(), ['approve', 'return-to-requester'].sort())
  assert.deepEqual(allowedActions('SUBMITTED', accountant), [])
  assert.deepEqual(allowedActions('SUBMITTED', auditor), [])
})

test('APPROVED: only accountant (or higher) can post/return', () => {
  assert.deepEqual(allowedActions('APPROVED', requester), [])
  assert.deepEqual(allowedActions('APPROVED', approver).sort(), ['post', 'return-to-approver', 'return-to-requester'].sort())
  assert.deepEqual(allowedActions('APPROVED', accountant).sort(), ['post', 'return-to-approver', 'return-to-requester'].sort())
  assert.deepEqual(allowedActions('APPROVED', auditor), [])
})

test('POSTED: no actions allowed (terminal)', () => {
  assert.deepEqual(allowedActions('POSTED', requester), [])
  assert.deepEqual(allowedActions('POSTED', approver), [])
  assert.deepEqual(allowedActions('POSTED', accountant), [])
})

test('RETURNED_TO_REQUESTER: only requester can resubmit/delete', () => {
  assert.deepEqual(allowedActions('RETURNED_TO_REQUESTER', requester).sort(), ['delete', 'resubmit'])
  assert.deepEqual(allowedActions('RETURNED_TO_REQUESTER', otherUser), [])
  assert.deepEqual(allowedActions('RETURNED_TO_REQUESTER', approver), [])
  assert.deepEqual(allowedActions('RETURNED_TO_REQUESTER', accountant), [])
})

test('RETURNED_TO_APPROVER: only approver can approve/return-to-requester', () => {
  assert.deepEqual(allowedActions('RETURNED_TO_APPROVER', approver).sort(), ['approve', 'return-to-requester'].sort())
  assert.deepEqual(allowedActions('RETURNED_TO_APPROVER', accountant), [])
  assert.deepEqual(allowedActions('RETURNED_TO_APPROVER', requester), [])
})

test('applyAction: SUBMITTED → APPROVED', () => {
  assert.equal(applyAction('SUBMITTED', 'approve', approver), 'APPROVED')
})

test('applyAction: APPROVED → POSTED', () => {
  assert.equal(applyAction('APPROVED', 'post', accountant), 'POSTED')
})

test('applyAction: APPROVED → RETURNED_TO_APPROVER (from accountant)', () => {
  assert.equal(applyAction('APPROVED', 'return-to-approver', accountant), 'RETURNED_TO_APPROVER')
})

test('applyAction: RETURNED_TO_REQUESTER → SUBMITTED on resubmit', () => {
  assert.equal(applyAction('RETURNED_TO_REQUESTER', 'resubmit', requester), 'SUBMITTED')
})

test('applyAction: rejects illegal transitions', () => {
  // POSTED is terminal — no one can change it
  assert.throws(() => applyAction('POSTED', 'approve', approver))
  // SUBMITTED can't be posted directly
  assert.throws(() => applyAction('SUBMITTED', 'post', accountant))
  // Auditor cannot approve
  assert.throws(() => applyAction('SUBMITTED', 'approve', auditor))
  // Non-requester cannot delete
  assert.throws(() => applyAction('RETURNED_TO_REQUESTER', 'delete', otherUser))
})

test('OWNER can also approve and post (hierarchy)', () => {
  const owner: ActorContext = { role: 'OWNER', userId: 'u6', isRequester: false }
  assert.equal(applyAction('SUBMITTED', 'approve', owner), 'APPROVED')
  assert.equal(applyAction('APPROVED', 'post', owner), 'POSTED')
})

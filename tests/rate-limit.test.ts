import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  checkRateLimit,
  recordFailure,
  clearFailures,
  __testing,
} from '../src/lib/security/rate-limit'

beforeEach(() => __testing.store.clear())

test('allows requests under the short limit', () => {
  for (let i = 0; i < 5; i++) {
    const r = checkRateLimit('user1', { shortMax: 5, longMax: 20 })
    assert.equal(r.allowed, true)
    recordFailure('user1')
  }
})

test('blocks the 6th attempt when shortMax = 5', () => {
  for (let i = 0; i < 5; i++) {
    checkRateLimit('user2', { shortMax: 5, longMax: 20 })
    recordFailure('user2')
  }
  const r = checkRateLimit('user2', { shortMax: 5, longMax: 20 })
  assert.equal(r.allowed, false)
  assert.equal(r.reason, 'short')
  assert.ok(r.retryAfterSeconds > 0)
})

test('blocks subsequent calls while in lockout', () => {
  for (let i = 0; i < 5; i++) { checkRateLimit('u3', { shortMax: 5 }); recordFailure('u3') }
  checkRateLimit('u3', { shortMax: 5 })  // triggers blockedUntil
  const next = checkRateLimit('u3', { shortMax: 5 })
  assert.equal(next.allowed, false)
  assert.equal(next.reason, 'blocked')
})

test('clearFailures lets successful login reset the counter', () => {
  for (let i = 0; i < 4; i++) recordFailure('u4')
  clearFailures('u4')
  const r = checkRateLimit('u4', { shortMax: 5, longMax: 20 })
  assert.equal(r.allowed, true)
  assert.equal(r.remaining, 5)
})

test('different identifiers do not share buckets', () => {
  for (let i = 0; i < 5; i++) recordFailure('alice')
  const a = checkRateLimit('alice', { shortMax: 5 })
  const b = checkRateLimit('bob', { shortMax: 5 })
  assert.equal(a.allowed, false)
  assert.equal(b.allowed, true)
})

import { db } from '../db'

/**
 * Period locking. Once a fiscal period is closed, no journal entries (or
 * payments that auto-create JEs) may be created or edited with a date on or
 * before the period end. OWNER/ADMIN can release a lock to fix mistakes.
 *
 * Enforcement points:
 *   - JournalEntry create/edit  → check `entry.date`
 *   - Payment.postNow / Payment.postPaymentToGl → check `payment.paymentDate`
 *   - Payment.void (reversing JE dated NOW) → check today's date
 *
 * The latest unreleased lock with the greatest periodEnd is the active cutoff.
 */

export async function getActiveLockedThrough(entityId: string): Promise<Date | null> {
  const lock = await db.lockedPeriod.findFirst({
    where: { entityId, releasedAt: null },
    orderBy: { periodEnd: 'desc' },
    select: { periodEnd: true },
  })
  return lock?.periodEnd ?? null
}

export interface PeriodCheck { ok: boolean; lockedThrough?: Date; reason?: string }

export async function isDateLocked(entityId: string, date: Date): Promise<PeriodCheck> {
  const cutoff = await getActiveLockedThrough(entityId)
  if (!cutoff) return { ok: true }
  // The cutoff is inclusive — equal dates are also locked.
  if (date.getTime() <= cutoff.getTime()) {
    return {
      ok: false,
      lockedThrough: cutoff,
      reason: `Period is closed through ${cutoff.toISOString().slice(0, 10)}. Unlock to post on or before this date.`,
    }
  }
  return { ok: true, lockedThrough: cutoff }
}

/** Throws with a user-friendly message if the date is in a locked period. */
export async function assertDateUnlocked(entityId: string, date: Date): Promise<void> {
  const c = await isDateLocked(entityId, date)
  if (!c.ok) throw new Error(c.reason ?? 'Period is locked')
}

export async function lockPeriod(input: {
  entityId: string
  periodEnd: Date
  lockedBy?: string
  reason?: string
}) {
  return db.lockedPeriod.create({
    data: {
      entityId: input.entityId,
      periodEnd: input.periodEnd,
      lockedBy: input.lockedBy,
      reason: input.reason,
    },
  })
}

export async function releaseLock(input: { id: string; entityId: string; releasedBy?: string }) {
  return db.lockedPeriod.updateMany({
    where: { id: input.id, entityId: input.entityId, releasedAt: null },
    data: { releasedAt: new Date(), releasedBy: input.releasedBy },
  })
}

export async function listLocks(entityId: string) {
  return db.lockedPeriod.findMany({
    where: { entityId },
    orderBy: { periodEnd: 'desc' },
  })
}

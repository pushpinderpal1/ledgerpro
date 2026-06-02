import type { Prisma } from '@prisma/client'
import {
  computeOpeningBalanceLines, resolveOpeningDate, OBE_CODE, OBE_NAME,
  type AccountTypeStr,
} from './index'

/**
 * Find or create the "Opening Balance Equity" account for the entity.
 * This system-managed equity account is the contra side for all opening
 * balance journal entries.
 */
export async function ensureOpeningBalanceEquityAccount(
  tx: Prisma.TransactionClient,
  entityId: string,
) {
  let obe = await tx.account.findFirst({ where: { entityId, code: OBE_CODE } })
  if (!obe) {
    obe = await tx.account.create({
      data: {
        entityId,
        code: OBE_CODE,
        name: OBE_NAME,
        type: 'EQUITY',
        description: 'System-managed contra account for opening balances. Do not delete.',
        openingBalance: 0,
      },
    })
  }
  return obe
}

/**
 * Idempotent upsert of the opening-balance JE for one account.
 *
 *   openingBalance == 0  → delete any existing OB JE for this account
 *   openingBalance != 0  → create or update the OB JE so its single
 *                          account-side line matches the new amount
 *
 * Wrapped in the caller's transaction. Skips the OBE account itself
 * (no self-referencing contra).
 */
export async function upsertOpeningBalanceJE(
  tx: Prisma.TransactionClient,
  args: {
    entityId: string
    account: { id: string; code: string; name: string; type: AccountTypeStr }
    openingBalance: number
    createdBy?: string | null
  },
) {
  const { entityId, account, openingBalance, createdBy } = args

  // Don't post for the OBE account itself
  if (account.code === OBE_CODE) return

  // Locate any existing OB JE that has a line on this account.
  const existing = await tx.journalEntry.findFirst({
    where: {
      entityId,
      source: 'OPENING_BALANCE',
      lines: { some: { accountId: account.id } },
    },
    select: { id: true, ref: true },
  })

  if (openingBalance === 0) {
    if (existing) {
      // Cascade-delete the lines first (journal_lines has FK to journal_entries)
      await tx.journalLine.deleteMany({ where: { journalEntryId: existing.id } })
      await tx.journalEntry.delete({ where: { id: existing.id } })
    }
    return
  }

  const [obe, entity] = await Promise.all([
    ensureOpeningBalanceEquityAccount(tx, entityId),
    tx.legalEntity.findUnique({ where: { id: entityId }, select: { openingDate: true } }),
  ])
  const opDate = resolveOpeningDate(entity ?? { openingDate: null })

  const lineSpecs = computeOpeningBalanceLines({
    account, openingBalance, obeAccountId: obe.id,
  })!

  if (existing) {
    // Update path: keep the ref and JE id stable, just refresh lines + date
    await tx.journalLine.deleteMany({ where: { journalEntryId: existing.id } })
    await tx.journalEntry.update({
      where: { id: existing.id },
      data: {
        date: opDate,
        description: `Opening balance: ${account.code} - ${account.name}`,
        lines: { create: lineSpecs },
      },
    })
  } else {
    // Create: derive a unique ref from existing JE count to avoid clashes
    // if the account code is reused later.
    const jeCount = await tx.journalEntry.count({ where: { entityId } })
    const ref = `OB-${String(jeCount + 1).padStart(4, '0')}`
    await tx.journalEntry.create({
      data: {
        entityId,
        ref,
        date: opDate,
        description: `Opening balance: ${account.code} - ${account.name}`,
        status: 'POSTED',
        source: 'OPENING_BALANCE',
        postedAt: new Date(),
        createdBy: createdBy ?? undefined,
        lines: { create: lineSpecs },
      },
    })
  }
}

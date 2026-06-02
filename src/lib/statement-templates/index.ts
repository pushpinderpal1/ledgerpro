import { db } from '../db'
import {
  runTemplate, validateTemplate,
  type StatementLine, type AccountMeta, type RenderedRow,
} from './runner'

/**
 * DB-backed wrapper. Loads balances from posted journal lines in the given
 * date range, then defers to the pure runner.
 */

export interface RunOptions {
  entityId: string
  from?: Date
  to?: Date
}

export interface RunResult {
  rows: RenderedRow[]
  grandTotal: number
  range: { from?: string; to?: string }
}

export async function runStatementTemplate(
  lines: StatementLine[],
  opts: RunOptions,
): Promise<RunResult> {
  const errs = validateTemplate(lines)
  if (errs.length > 0) throw new Error('Invalid template: ' + errs.join('; '))

  // Collect all account IDs referenced by the template — we only need balances
  // for those accounts (not the whole COA). This keeps the query tight.
  const referencedIds = new Set<string>()
  for (const line of lines) {
    if (line.type === 'ACCOUNT' && line.accountId) referencedIds.add(line.accountId)
    if (line.type === 'GROUP' && line.accountIds) for (const id of line.accountIds) referencedIds.add(id)
  }

  // Load account metadata in one query.
  const accounts = await db.account.findMany({
    where: { id: { in: [...referencedIds] }, entityId: opts.entityId },
    select: { id: true, code: true, name: true, type: true },
  })
  const accountsById = new Map<string, AccountMeta>(
    accounts.map(a => [a.id, { id: a.id, code: a.code, name: a.name, type: a.type as AccountMeta['type'] }]),
  )

  // Load posted journal lines for these accounts, filtered to the date range,
  // and aggregate to (debit − credit) per account in one pass.
  const rawByAccount = new Map<string, number>()
  if (referencedIds.size > 0) {
    const where: Parameters<typeof db.journalLine.findMany>[0] = {
      where: {
        accountId: { in: [...referencedIds] },
        entry: {
          entityId: opts.entityId,
          status: 'POSTED',
          ...(opts.from || opts.to ? {
            date: {
              ...(opts.from ? { gte: opts.from } : {}),
              ...(opts.to   ? { lte: opts.to   } : {}),
            },
          } : {}),
        },
      },
      select: { accountId: true, debit: true, credit: true },
    } as Parameters<typeof db.journalLine.findMany>[0]

    const rows = await db.journalLine.findMany(where)
    for (const r of rows as Array<{ accountId: string; debit: unknown; credit: unknown }>) {
      const cur = rawByAccount.get(r.accountId) ?? 0
      rawByAccount.set(r.accountId, cur + Number(r.debit) - Number(r.credit))
    }
  }

  const out = runTemplate({ lines, rawByAccount, accountsById })
  return {
    rows: out.rows,
    grandTotal: out.grandTotal,
    range: {
      from: opts.from?.toISOString().slice(0, 10),
      to: opts.to?.toISOString().slice(0, 10),
    },
  }
}

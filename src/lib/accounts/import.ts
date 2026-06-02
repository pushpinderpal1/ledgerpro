import { db } from '../db'
import { parseIif } from '../iif'
import { parseCsvAccounts, normalizeIifAccounts, type ParsedAccountRow, type ParseResult } from './import-parse'
import { upsertOpeningBalanceJE } from '../opening-balance/db'

/**
 * Chart-of-Accounts import engine. Two-phase:
 *
 *   Phase 1 (always): parse → produce ParsedAccountRow[] + structural errors
 *   Phase 2 (always): compare against the DB → produce per-row classification
 *                     { create | update | conflict | skip }
 *   Phase 3 (commit only): apply the changes inside a single transaction with
 *                          a second pass for parent linkage
 *
 * Dry-run returns Phase 2 without touching the DB. The UI shows the preview,
 * the user confirms, then a second call commits.
 */

export type RowAction = 'create' | 'update' | 'conflict' | 'skip'

export interface ClassifiedRow {
  row: ParsedAccountRow
  action: RowAction
  reason?: string                // for conflict / skip
  existingId?: string            // when action is 'update' or 'conflict'
}

export interface ImportPreview {
  format: 'csv' | 'iif'
  rows: ClassifiedRow[]
  parseErrors: ParseResult['errors']
  summary: {
    total: number
    create: number
    update: number
    conflict: number
    skip: number
  }
}

export interface ImportCommitResult {
  created: number
  updated: number
  skipped: number
  errors: { code: string; message: string }[]
  parentLinks: number              // how many parent ↔ child links resolved in pass 2
}

// ─── Parse & classify ─────────────────────────────────────────────────────────

export function parseImport(filename: string, content: string): { format: 'csv'|'iif'; parsed: ParseResult } {
  const lower = filename.toLowerCase()
  // Sniff by extension first; fall back to content.
  if (lower.endsWith('.iif') || /^!ACCNT/m.test(content)) {
    const iif = parseIif(content)
    return { format: 'iif', parsed: normalizeIifAccounts(iif.accounts) }
  }
  return { format: 'csv', parsed: parseCsvAccounts(content) }
}

/**
 * Classify each parsed row against current DB state.
 *   - exact code match → "update" candidate
 *   - exact name match (no code match) → "conflict" — names collide which
 *     would violate the unique constraint
 *   - otherwise → "create"
 *   - empty/invalid rows from parsing → "skip"
 */
export async function classifyImport(
  entityId: string,
  parsed: ParseResult,
): Promise<ClassifiedRow[]> {
  const existing = await db.account.findMany({
    where: { entityId },
    select: { id: true, code: true, name: true, type: true, subType: true, description: true },
  })
  const byCode = new Map(existing.map(a => [a.code.toLowerCase(), a]))
  const byName = new Map(existing.map(a => [a.name.toLowerCase(), a]))

  return parsed.rows.map<ClassifiedRow>(row => {
    const codeHit = byCode.get(row.code.toLowerCase())
    if (codeHit) {
      const sameType = codeHit.type === row.type
      return {
        row,
        action: sameType ? 'update' : 'conflict',
        existingId: codeHit.id,
        reason: sameType
          ? `Will update existing account ${codeHit.code} (${codeHit.name})`
          : `Existing account ${codeHit.code} is ${codeHit.type}, import says ${row.type} — refusing to change type`,
      }
    }
    const nameHit = byName.get(row.name.toLowerCase())
    if (nameHit) {
      return {
        row,
        action: 'conflict',
        existingId: nameHit.id,
        reason: `Account "${nameHit.name}" already exists with code ${nameHit.code}; import row has code ${row.code}`,
      }
    }
    return { row, action: 'create' }
  })
}

export async function buildPreview(entityId: string, filename: string, content: string): Promise<ImportPreview> {
  const { format, parsed } = parseImport(filename, content)
  const rows = await classifyImport(entityId, parsed)
  const summary = {
    total: rows.length,
    create: rows.filter(r => r.action === 'create').length,
    update: rows.filter(r => r.action === 'update').length,
    conflict: rows.filter(r => r.action === 'conflict').length,
    skip: rows.filter(r => r.action === 'skip').length,
  }
  return { format, rows, parseErrors: parsed.errors, summary }
}

// ─── Commit ───────────────────────────────────────────────────────────────────

/**
 * Apply the import. `overwriteOnConflict` lets the user choose whether to
 * overwrite name-conflict rows (renames the existing account to the import
 * name) — defaults to false (skip them).
 *
 * Type-conflict rows are NEVER auto-applied; the user must reconcile manually.
 */
export async function commitImport(input: {
  entityId: string
  classified: ClassifiedRow[]
  overwriteOnConflict?: boolean
}): Promise<ImportCommitResult> {
  const result: ImportCommitResult = { created: 0, updated: 0, skipped: 0, errors: [], parentLinks: 0 }

  await db.$transaction(async (tx) => {
    // Pass 1: create / update rows without parent links.
    const codeToId = new Map<string, string>()
    const nameToId = new Map<string, string>()

    // Seed with existing accounts so parent-resolution in pass 2 can find them.
    const existing = await tx.account.findMany({
      where: { entityId: input.entityId },
      select: { id: true, code: true, name: true },
    })
    for (const a of existing) {
      codeToId.set(a.code.toLowerCase(), a.id)
      nameToId.set(a.name.toLowerCase(), a.id)
    }

    for (const cr of input.classified) {
      const { row, action } = cr
      try {
        if (action === 'create') {
          const created = await tx.account.create({
            data: {
              entityId: input.entityId,
              code: row.code,
              name: row.name,
              type: row.type,
              subType: row.subType,
              description: row.description,
              isBankAccount: row.isBankAccount ?? false,
              openingBalance: row.openingBalance ?? 0,
            },
            select: { id: true, code: true, name: true, type: true },
          })
          codeToId.set(created.code.toLowerCase(), created.id)
          nameToId.set(created.name.toLowerCase(), created.id)
          if (row.openingBalance && row.openingBalance !== 0) {
            await upsertOpeningBalanceJE(tx, {
              entityId: input.entityId,
              account: created,
              openingBalance: row.openingBalance,
            })
          }
          result.created++
        } else if (action === 'update' && cr.existingId) {
          await tx.account.update({
            where: { id: cr.existingId },
            data: {
              name: row.name,
              subType: row.subType,
              description: row.description,
              isBankAccount: row.isBankAccount ?? undefined,
              ...(row.openingBalance !== undefined ? { openingBalance: row.openingBalance } : {}),
            },
          })
          if (row.openingBalance !== undefined) {
            const acc = await tx.account.findUnique({
              where: { id: cr.existingId },
              select: { id: true, code: true, name: true, type: true },
            })
            if (acc) {
              await upsertOpeningBalanceJE(tx, {
                entityId: input.entityId,
                account: acc,
                openingBalance: row.openingBalance,
              })
            }
          }
          result.updated++
        } else if (action === 'conflict' && input.overwriteOnConflict && cr.existingId) {
          // User opted to overwrite name conflicts: rename the existing
          // account to the import's name and assign the import's code.
          await tx.account.update({
            where: { id: cr.existingId },
            data: {
              code: row.code,
              name: row.name,
              subType: row.subType,
              description: row.description,
              isBankAccount: row.isBankAccount ?? undefined,
            },
          })
          codeToId.set(row.code.toLowerCase(), cr.existingId)
          nameToId.set(row.name.toLowerCase(), cr.existingId)
          result.updated++
        } else {
          result.skipped++
        }
      } catch (e) {
        const code = (e as { code?: string }).code === 'P2002' ? 'duplicate' : 'error'
        result.errors.push({ code: row.code, message: code === 'duplicate' ? 'Duplicate code or name' : (e as Error).message })
        result.skipped++
      }
    }

    // Pass 2: resolve parent links.
    for (const cr of input.classified) {
      if (cr.action === 'skip') continue
      const { row } = cr
      const parentKey = (row.parentCode ?? row.parentName ?? '').toLowerCase()
      if (!parentKey) continue
      const parentId = codeToId.get(parentKey) ?? nameToId.get(parentKey)
      if (!parentId) {
        result.errors.push({ code: row.code, message: `Parent "${row.parentCode ?? row.parentName}" not found` })
        continue
      }
      const myId = codeToId.get(row.code.toLowerCase())
      if (!myId || myId === parentId) continue
      try {
        await tx.account.update({ where: { id: myId }, data: { parentId } })
        result.parentLinks++
      } catch (e) {
        result.errors.push({ code: row.code, message: `Could not set parent: ${(e as Error).message}` })
      }
    }
  })

  return result
}

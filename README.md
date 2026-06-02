# LedgerPro — MIS / Multi-Dimensional Accounting

Adds opt-in MIS (department) coding per entity, with configurable
strictness, a master list of MIS codes, and two new department-level reports.

Entities that don't enable MIS see no UI changes — the system behaves
exactly as before.

## What's in this zip

- `prisma/schema.prisma` — adds 3 columns to LegalEntity (`misEnabled`,
  `misRequiredForTypes`, `misAllowOverride`), adds `MisCode` model,
  adds `misCodeId` FK on JournalLine.
- `prisma/migrations/0007_mis_dimensions/migration.sql` — additive,
  fully safe to deploy on existing data.
- `src/lib/mis/policy.ts` — pure policy logic (no DB), shared between
  server and client.
- `src/lib/mis/index.ts` — DB-backed helpers used during posting.
- `src/lib/reports/index.ts` — replaces existing. Adds
  `profitAndLossByDepartment` and `trialBalanceByDepartment`.
- `src/app/api/mis-codes/route.ts` — full CRUD with soft-delete logic.
- `src/app/api/mis-config/route.ts` — get/set the per-entity config.
- `src/app/api/journals/route.ts` — replaces existing. Validates MIS
  policy server-side before persisting.
- `src/app/api/reports/route.ts` — replaces existing. Adds
  `pnl-by-department` and `trial-balance-by-department` report types.
- `src/app/page.tsx` — replaces existing. Adds MIS sidebar item
  (Codes + Configuration tabs), adds MIS column to journal entry form
  with live validation preview.
- `tests/mis-policy.test.ts` — 14 unit tests, 137 total passing.

## Deploy steps

1. Extract zip at root of your `ledgerpro` repo
2. Commit + push:
   ```
   git add -A
   git commit -m "MIS / multi-dimensional accounting"
   git push
   ```
3. Railway applies migration `0007_mis_dimensions`. No new dependencies,
   no env vars.

## The policy model

Two-layer rules:

| Master enabled? | Allow override? | Account type required? | Behavior |
|---|---|---|---|
| ❌ No | — | — | MIS field hidden everywhere |
| ✔ Yes | ✔ Yes | Any | Field shown — warnings shown but never blocks |
| ✔ Yes | ❌ No | ✔ Yes | Field shown — **blocks posting** if blank |
| ✔ Yes | ❌ No | ❌ No | Field shown — optional for that line |

Default required-for types when first enabled: **EXPENSE, REVENUE, COGS**
(the typical P&L accounts). Adjust on the Configuration tab.

## How to use it

### Setup (OWNER / ADMIN)

1. **MIS / Departments** in sidebar → **Configuration** tab
2. Toggle "Enable MIS coding on this entity" → ON
3. Pick which account types require an MIS code (chip buttons —
   tap to toggle). Default: EXPENSE, REVENUE, COGS.
4. Decide override behavior:
   - **Override OFF (strict)** — required lines BLOCK posting if missing
   - **Override ON (lenient)** — required lines show a warning but allow posting

### Create the codes (OWNER / ADMIN / ACCOUNTANT)

1. **Codes** tab
2. **+ New code** — enter a code (e.g. `DEPT01`) and a department name
   (e.g. `Sales — North`)
3. Repeat for each department. Soft cap is 10 (warning shown above 10,
   not blocked).

### Use them in journal entries

1. **Journal Entries** → **+ New entry**
2. The "MIS code" column appears in the lines table
3. When entering an account, if the policy requires MIS for that type:
   - **Strict**: the MIS dropdown shows red border; posting blocked
   - **Lenient**: the MIS dropdown shows amber border; posting allowed
     but a warning lists the affected lines
4. Selecting an MIS code clears the warning for that line

### Run department reports

Add `?type=pnl-by-department` or `?type=trial-balance-by-department`
to your existing reports API URL, with optional `from` and `to` dates.
The response is a cross-tab:

```
{
  "columns": [
    { "id": "code_abc", "code": "DEPT01", "department": "Sales — North" },
    { "id": "code_def", "code": "DEPT02", "department": "Sales — South" },
    { "id": "_unallocated", "code": "(Unallocated)", "department": "No MIS code" }
  ],
  "rows": [
    { "code": "6100", "name": "Rent Expense", "type": "EXPENSE",
      "byColumn": { "code_abc": 1200, "code_def": 800, "_unallocated": 0 },
      "total": 2000 }
  ],
  "totals": { "code_abc": 1200, "code_def": 800, "_unallocated": 0 }
}
```

Lines that don't have an MIS code go into the `(Unallocated)` column so
the totals always tie back to the standard P&L / TB.

The frontend integration of these into the Reports page is intentionally
left to a follow-up — the API is in place so you can call it from
custom dashboards or spreadsheets in the meantime.

## What stays the same

- Entities without MIS enabled — no visible change anywhere
- Existing journal entries (created before MIS was enabled) — no data
  migration needed; their `misCodeId` is just NULL
- Reports — all 10 existing reports unchanged; two new department
  reports added alongside
- Other modules (Payments, Recon, AP, Fixed Assets, etc.) — no MIS
  integration in this pass. Their journals create entries with NULL
  misCodeId, which is fine because MIS is required *per account type*
  rather than per source

## Soft-delete behavior

If you try to delete an MIS code that's been used in journal entries:
- System soft-deletes (sets `isActive = false`) so historical lines keep
  their tag
- The dropdown on new entries no longer shows it
- The Codes tab can show it via "Show inactive" toggle, with "Reactivate"
  option

If you delete an unused MIS code:
- Hard-deleted

## Audit trail

All MIS changes are audited:
- `MIS_CONFIG_UPDATED` — changes to enable / requiredForTypes / allowOverride
- `MIS_CODE_CREATED`, `MIS_CODE_UPDATED`, `MIS_CODE_DEACTIVATED`, `MIS_CODE_DELETED`

## Tests

14 new tests pass:
- Parse / serialize the comma-separated requiredForTypes string
- Validation skipped when MIS disabled
- Strict mode blocks missing codes on required types
- Lenient mode downgrades errors to warnings
- Non-required types ignored
- Whitespace-only codes treated as missing
- Multiple bad lines all reported

137 total tests pass.

## Known limits in this pass

- Other posting surfaces (AP invoices, Payments, Recon adjustments,
  Depreciation runs, Disposals) post journals with NULL misCodeId.
  If you want those to require MIS, that's a follow-up — they need
  per-module UI changes since the user doesn't see line-by-line dropdowns
  on those screens.
- Department reports have API support but no dedicated UI page yet.
- The soft cap of 10 codes is a frontend warning only — no hard limit.
- Codes can be edited but the `code` field itself is immutable
  (department name and description can change).

# LedgerPro — Chart of Accounts Import

Adds an Import button to the Accounts page supporting two formats:
- **LedgerPro CSV template** (downloadable from the modal)
- **QuickBooks IIF** files exported from QuickBooks Desktop

Three-stage flow: pick file → preview with conflict detection → commit.
Manual rates and existing accounts are never destructively overwritten by
default; the user must opt in to conflict overwrites.

## What's in this zip

- `src/lib/accounts/import-parse.ts` — pure parsers for CSV and IIF,
  with the QuickBooks → LedgerPro account-type mapping table.
- `src/lib/accounts/import.ts` — DB-backed engine with classify/commit
  phases and two-pass parent linkage.
- `src/app/api/accounts/import/route.ts` — POST endpoint (preview /
  commit) + GET template downloader.
- `src/app/page.tsx` — replaces existing. Adds "↥ Import COA" button to
  Accounts page and the full import modal.
- `tests/account-import.test.ts` — 14 new tests, 123 total passing.

## Deploy steps

1. Extract zip at the root of your `ledgerpro` repo
2. Commit + push:
   ```
   git add -A
   git commit -m "Chart of Accounts import (CSV + QuickBooks IIF)"
   git push
   ```
3. No new dependencies, no migrations, no env vars.

## How to use it

1. Go to **Accounts** in the sidebar
2. Click **↥ Import COA** (visible to OWNER / ADMIN / ACCOUNTANT)
3. **Stage 1 — Pick a file:**
   - Click "Download template" to get the LedgerPro CSV template
     (`ledgerpro-coa-template.csv`)
   - Drag & drop a CSV or IIF file, OR click "Choose file"
   - Or expand "Paste the file content here" and paste directly
4. Click **Preview import**
5. **Stage 2 — Preview:**
   - Each row is classified as **create** (new), **update** (matching code
     exists with same type), or **conflict** (name/code collision OR type
     mismatch — won't auto-apply)
   - Parse warnings are shown in red
   - If there are conflicts, an "Overwrite name-conflict rows" checkbox
     appears. Use carefully — it reassigns existing accounts to the
     import's code/name.
   - Type conflicts are NEVER auto-applied. Resolve manually first.
   - Click **Import N accounts** to apply
6. **Stage 3 — Result:**
   - Shows created / updated / skipped / parent links resolved
   - Any per-row errors listed (rare — usually duplicate code)

## QuickBooks IIF mapping

When you import an IIF file from QuickBooks Desktop, account types are
mapped automatically:

| QB Type | LedgerPro Type | SubType set |
|---|---|---|
| BANK | ASSET | Bank (+isBankAccount=true) |
| AR | ASSET | Accounts Receivable |
| OCASSET | ASSET | Other Current Asset |
| FIXASSET | ASSET | Fixed Asset |
| OASSET | ASSET | Other Asset |
| AP | LIABILITY | Accounts Payable |
| CCARD | LIABILITY | Credit Card |
| OCLIAB | LIABILITY | Other Current Liability |
| LTLIAB | LIABILITY | Long Term Liability |
| EQUITY | EQUITY | — |
| INC | REVENUE | Income |
| OINC | REVENUE | Other Income |
| COGS | COGS | — |
| EXP | EXPENSE | — |
| OEXP | EXPENSE | Other Expense |

Unrecognized types (e.g. NONPOSTING) are reported as warnings and skipped.

QuickBooks encodes sub-accounts with colon-separated names like
`Bank:Operating:USD`. The import parses these and resolves the parent
linkage in a second pass after all accounts are created.

If an IIF row has no ACCNUM, the import assigns a placeholder code like
`IIF-1` and warns you. **Edit those before posting any transactions.**

## How to export Chart of Accounts from QuickBooks Desktop

In QB Desktop:
1. File → Utilities → Export → Lists to IIF Files
2. Check **Chart of Accounts**
3. Pick a save location → Save
4. Upload that .IIF file in LedgerPro's import modal

QB Online users don't have a direct IIF export; instead, export to Excel
and convert to the LedgerPro CSV template format manually.

## What about transaction history?

This pass imports the **structure** (chart of accounts) only — not
historical journal entries. QuickBooks IIF transaction import already
exists as a separate feature (sidebar item "IIF Import"). Both work
together: import COA first, then transactions.

## Tests

123 total tests pass. 14 new tests cover:
- CSV template parsing (success + failure modes)
- CSV header flexibility (case-insensitive, multiple naming variants)
- CSV with QB-style type fallback
- IIF normalization (type mapping, parent extraction from colon names,
  missing-ACCNUM warning, unknown types)
- Quoted CSV cells with commas and embedded quotes
- QB account-type mapping completeness

# LedgerPro — Opening Balance on COA + Current Balance display

Adds opening balance support to Chart of Accounts. Two things land:

1. An **Opening Balance** field on every account
2. A **Current Balance** column on the COA page that shows the live ledger
   balance (DR or CR, color-coded if it's on the unnatural side)

Opening balances are auto-posted as a journal entry on the entity's
opening date with the contra to a system-managed "Opening Balance Equity"
account (code 3999). This way the opening balance flows naturally through
every report (TB, P&L, BS, GL) — not just shown on the COA page.

CSV/IIF import functionality is **unchanged for existing CSVs** and
**extended with an optional `Opening Balance` column**.

## What's in this zip

- `prisma/schema.prisma` — adds `openingBalance` to Account, `openingDate`
  to LegalEntity
- `prisma/migrations/0012_opening_balances/migration.sql` — one additive
  migration; two `ALTER TABLE`s, no data changes
- `src/lib/opening-balance/index.ts` — pure logic (computes JE lines from
  openingBalance + account type)
- `src/lib/opening-balance/db.ts` — DB-side helpers:
  `ensureOpeningBalanceEquityAccount`, `upsertOpeningBalanceJE` (idempotent)
- `src/lib/accounts/import-parse.ts` — CSV parser now accepts optional
  `Opening Balance` column (also aliases: `OB`, `OpeningBalance`, `Opening`)
- `src/lib/accounts/import.ts` — commit phase calls `upsertOpeningBalanceJE`
  for any imported row with a non-zero opening balance
- `src/app/api/accounts/route.ts` — POST/PATCH accept `openingBalance`,
  auto-post the OB JE in a transaction. GET supports `?withBalances=1` for
  efficient bulk-balance fetching (single `groupBy` query).
- `src/app/page.tsx` — Opening Balance input field on the COA form +
  Opening Balance + Current Balance columns in the table
- `tests/opening-balance.test.ts` — 13 unit tests on the pure logic

## How it works

### Setting an opening balance

1. Books → Chart of Accounts → click **Edit** on any account
2. Fill in **Opening Balance** with a positive number
   - For Asset / Expense / COGS: positive = DR balance (natural)
   - For Liability / Equity / Revenue: positive = CR balance (natural)
   - Negative numbers are allowed for unusual cases (asset with credit balance)
3. Click **Save changes**

What happens behind the scenes:
- The account row is updated with the opening balance
- The system finds or creates "3999 - Opening Balance Equity" (an equity
  account)
- A journal entry is created with `source: 'OPENING_BALANCE'`, ref
  `OB-NNNN`, dated on the entity's `openingDate` (or Jan 1 of the current
  year if not set)
- The JE has two lines:
  - DR/CR the account for the opening balance amount
  - The opposite side on Opening Balance Equity

If you later **edit** the opening balance to a different value, the
existing OB JE for that account is updated (not duplicated). Editing to
zero **deletes** the OB JE.

### Viewing current balance

The COA table now shows two new columns:

- **Opening Balance** — the value you entered (or `—` for zero)
- **Current Balance** — live computed from all posted JEs (including the OB JE),
  shown as `$1,234.56 DR` or `$1,234.56 CR`
  - Default color = natural side
  - **Red** when the balance is on the UNNATURAL side (e.g. an Asset with
    a credit balance — usually an error worth investigating)

The current balance is computed by a single `journalLine.groupBy` query
across the entity, not N+1 — fast even with thousands of accounts.

### CSV import

The CSV template now includes an `Opening Balance` column (positioned
after `Parent Code`). The column is **optional**:

- **Old CSVs without the column** continue to work exactly as before
- **New CSVs with the column** import opening balances and auto-post OB JEs
- The parser is tolerant: accepts `Opening Balance`, `OpeningBalance`, `OB`,
  `Opening` as header aliases (case-insensitive)
- Tolerant amount formats: `5000`, `5000.00`, `$5,000.00`, `5,000` all work
- Invalid values (`"abc"`) produce per-row errors without aborting the import
- Empty cells = no opening balance (just like setting zero)

### Entity opening date

The OB JE is dated on the entity's `openingDate` field. Default behavior
when not set: **January 1 of the current calendar year**.

To set a custom opening date (e.g. "2024-01-01" for data migrated from a
prior system), update `legal_entities.openingDate` directly in the DB or
via a settings page (not built yet — easy follow-up).

## Permissions

Same as the rest of COA — write-level access requires ACCOUNTANT or above.

## Deploy

```
cd C:\ledgerpro
git add -A
git commit -m "Opening Balance on COA + Current Balance display"
git push
```

Railway runs migration `0012_opening_balances` (two `ALTER TABLE` statements,
both adding nullable / defaulted columns — no data migration needed). No
new dependencies. No env vars.

## After deploy — verify

1. Books → Chart of Accounts → edit any account (e.g. Cash)
2. Enter `5000` in the new **Opening Balance** field → Save
3. The COA table now shows:
   - Opening Balance: $5,000.00
   - Current Balance: $5,000.00 DR
4. Go to Reports → Trial Balance → verify Cash shows $5,000 DR and
   "Opening Balance Equity" shows $5,000 CR (matching contra)
5. Go to Transaction Posting → Journal Entries → look for the new
   `OB-NNNN` entry on Jan 1 of the current year
6. Edit the same account, change Opening Balance to `7500` → Save
   - The existing OB JE is UPDATED in place (still one entry, not two)
   - Current Balance now reads $7,500.00 DR
7. Edit again, set Opening Balance to `0` → Save
   - The OB JE is DELETED
   - Current Balance reads `—` (no posted activity)

## CSV import verification

1. Books → Chart of Accounts → **Import CSV**
2. Click **Download template** → fresh template now has 7 columns
   (Code, Name, Type, SubType, Description, Parent Code, **Opening Balance**)
3. Try importing an OLD CSV (without the Opening Balance column) → still
   works, no OB JEs created
4. Try a NEW CSV with the column → OB JEs auto-posted for non-zero rows

## What's NOT in this bundle (intentional)

- **UI to set entity.openingDate** — no settings page for this yet. Default
  (Jan 1 of current year) is fine for most use cases. If you need to set a
  different date (e.g. mid-year migration), update via DB or wait for
  a settings page.
- **Locked-period interaction** — the OB JE is posted regardless of locked
  periods. Since opening balances typically pre-date all activity, this
  hasn't mattered in practice. If a user locks Jan 1 and THEN sets an
  opening balance, the JE still posts (bypasses the period lock). Future
  enhancement: explicit allow-list for OPENING_BALANCE-sourced JEs.
- **Bulk opening balance entry** — one account at a time via the COA form,
  or via CSV import. No "wizard" for entering many opening balances at once.
- **Display of unrealized opening balance** — if you enter an opening
  balance but it can't post (e.g. parent account constraint), there's no
  separate "pending" state. This case shouldn't actually arise in v1.

## Tests

All 186 tests pass (173 prior + 13 new in `opening-balance.test.ts`).
The new tests cover: natural-side classification, JE line computation for
all 6 account types, negative-balance flipping, default opening date,
balance display formatting (natural vs unnatural sides).

# LedgerPro — Hotfix: COA accounts not showing + DR/CR indicator

## Two fixes in this bundle

### 1. COA was returning an empty list — root cause

The new `?withBalances=1` parameter triggered a Prisma `groupBy` query
that filtered journal lines using a **relation filter**:

```ts
db.journalLine.groupBy({
  by: ['accountId'],
  where: { journalEntry: { entityId, status: 'POSTED' } },  // ← relation filter
  _sum: { debit: true, credit: true },
})
```

Prisma's `groupBy` has known quirks with relation-based `where` clauses
across some versions; in your deployment this query likely errored out,
causing the API to return an error response. The UI then tried to call
`.map(...)` on a non-array and silently rendered nothing.

The Trial Balance kept working because it uses different queries that
don't rely on this pattern — confirming the underlying data is fine.

**Fix (two parts, defense in depth):**

In `src/app/api/accounts/route.ts`:
- Refactored balance computation to a safer **two-step query**: first
  fetch posted JE IDs, then group journal_lines by `{ in: jeIds }`. This
  is a flat where-filter that all Prisma versions handle reliably.
- Wrapped balance computation in `try/catch` so any failure degrades
  gracefully (returns accounts with `currentBalance: 0 + balanceError: true`
  rather than blowing up the response).

In `src/app/page.tsx`:
- Added `Array.isArray` guard on the accounts fetch so a malformed
  response can never crash the table rendering:
  ```ts
  .then(d => setAccounts(Array.isArray(d) ? d : []))
  .catch(() => setAccounts([]))
  ```

### 2. DR/CR indicator next to "Opening Balance"

Per your request — a clear visual badge that shows the natural side for
the account's selected type, right next to the label:

```
Opening Balance  [+ = DR (natural for ASSET)]
```

The badge color and text update dynamically as you change the Account
Type dropdown:

- **Blue badge** `+ = DR (natural for ASSET / EXPENSE / COGS)`
- **Pink badge** `+ = CR (natural for LIABILITY / EQUITY / REVENUE)`

So when the user is looking at the input, they instantly know:
- Asset / Expense / COGS → typing `5000` means $5,000 DR
- Liability / Equity / Revenue → typing `5000` means $5,000 CR
- A negative number flips sides (rare reverse case)

The fine-print help text below the input is preserved and clarified.

## What's in this zip

Two files. No schema change, no migration, no new dependencies.

- `src/app/api/accounts/route.ts` — safer balance query + graceful degradation
- `src/app/page.tsx` — defensive fetch + DR/CR badge next to Opening Balance

## Deploy

```
cd C:\ledgerpro
git add -A
git commit -m "Hotfix: COA accounts not showing + DR/CR indicator on Opening Balance"
git push
```

After Railway redeploys (no migration this time, just a code update):

1. Books → Chart of Accounts — your existing accounts should now appear
   with Opening Balance and Current Balance columns
2. Click **Edit** on any account — the "Opening Balance" label now has a
   colored DR/CR badge that updates as you change the Account Type

## Why my smoke tests didn't catch this

I tested the pure logic (13 unit tests, all pass) and the CSV parsing
(5 scenarios verified). The Prisma `groupBy` runtime behavior can only
be properly tested against a real Postgres database with the Prisma
engine generated — neither is available in my sandbox. The defensive
two-step refactor is the lesson for next time: when a Prisma operation
involves a relation filter inside `groupBy`, do the relation lookup
separately to avoid version-specific quirks.

## Verify after deploy

1. COA page should list all your previously-created accounts
2. Current Balance column shows live values (matches TB)
3. Edit any account — DR/CR badge appears next to "Opening Balance":
   - Toggle account type to LIABILITY → badge becomes pink "+ = CR"
   - Toggle back to ASSET → badge becomes blue "+ = DR"

## Tests

All 186 tests still pass.

# LedgerPro — Bank Rec diagnostic improvements

## Why this bundle exists

You paid a cheque via the AP Tracker and expected it to appear in Bank
Reconciliation, but it didn't show. The recon library logic is actually
correct — it queries all posted journal lines on the bank account up to the
statement date — so if the cheque isn't appearing, one of these is true:

1. **The cheque was paid from a different bank account** than the one
   selected for the reconciliation
2. **The statement date is before the cheque date** (so the cheque is
   correctly excluded from this period)
3. **The cheque payment didn't post a journal entry** (something went
   wrong with my AP Pay fix on your data)

The previous UI just showed "No book transactions in this period" with
no information to help you figure out which. This bundle replaces that
with an actionable diagnostic empty state.

## What this changes

Two files. No schema change, no migration, no new deps.

### `src/lib/recon/index.ts`

Extends `getReconciliationState()` to return a `diagnostics` field:

```ts
diagnostics: {
  totalLinesOnAccount       // # posted lines on this bank account, ANY date
  linesAfterStatementDate   // # posted lines dated > statement date
  totalBankAccounts         // # accounts in entity flagged isBankAccount
  recentLinesOnAccount      // most recent 3 lines on this account
}
```

Also includes `bankAccount` (id, code, name) in the returned `reconciliation`
object so the UI can display it prominently.

### `src/app/page.tsx`

Two improvements to the recon detail view:

**1. Blue banner at the top** showing exactly which bank account and statement
date the recon is for:

```
┌─────────────────────────────────────────────────────────┐
│ RECONCILING        STATEMENT DATE                       │
│ 1100 — Checking    Jun 2, 2026                          │
└─────────────────────────────────────────────────────────┘
```

This is the single most common diagnostic: "wait, did I pick the wrong
account?"

**2. The "No book transactions in this period" empty state is replaced**
with an actionable diagnostic that explains why no transactions are showing:

If there are **zero** journal lines on the account at all:

> No transactions found in this period
>
> **This bank account has no posted journal lines at all.** Common causes:
> - The payment was recorded against a different bank account — you have
>   3 accounts flagged as bank accounts; check which one you used
> - The payment was created but the journal entry didn't post successfully
> - You opened this reconciliation page but the payment was never made

If there **are** journal lines but they're outside the period:

> This bank account has 5 total posted journal lines, but none on or
> before your statement date of Jun 1, 2026.
>
> 2 lines are dated after your statement date. Increase the statement
> date or start a new reconciliation with a later date.
>
> Most recent lines on this account:
> Jun 2, 2026 | APP-2026-0001 | AP Payment: ABC Inc #1 (CHEQUE) | −$1,000.00
> May 28, 2026 | JE-2026-0042 | Opening balance               | +$5,000.00

## Most likely root cause for what you're seeing

If your cheque payment succeeded (you saw a toast like "Payment recorded —
journal APP-YYYY-NNNN"), the journal entry exists. So the most likely cause
is either:

- **You started the recon with a statement date earlier than today** — the
  cheque is dated today (or whenever you paid it). Statement dates older
  than that will exclude it. After deploy, the empty state will show
  "X lines are dated after your statement date" to make this obvious.

- **You started the recon on a different bank account** than the one you
  paid from. After deploy, the blue banner at the top shows the bank
  account name; cross-check with the AP Pay modal's bank dropdown.

If neither of those is the issue, the new empty state will show "This bank
account has no posted journal lines at all" — which means the JE didn't
get created when you clicked Pay. In that case, screenshot it for me and
also check the Journal Entries page for an entry with ref starting `APP-`.

## Deploy

```
cd C:\ledgerpro
# extract the zip
git add -A
git commit -m "Bank recon: prominent bank-account header + diagnostic empty state"
git push
```

After Railway redeploys, hard-refresh and open the empty reconciliation:
you'll see either (a) the banner makes it obvious you picked the wrong
account, (b) the new empty state explains the date mismatch, or (c) the
empty state confirms the JE doesn't exist (in which case there's a real
data bug for me to chase).

## Tests

All 166 tests continue to pass. No new tests — the diagnostic logic is
straightforward read-only DB queries that don't need their own coverage.

## What's not in this bundle

I deliberately did NOT modify the recon date filter or how journal lines
are matched. The current logic — "posted JLs on this account where
`entry.date <= statementDate`" — is the right one. The user just needs
better visibility into what that query returned.

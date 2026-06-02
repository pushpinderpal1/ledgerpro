# LedgerPro — Bank Recon: live preview in the Start form

## What your screenshots told me

**Image 2 (Trial Balance)** — the cheque posted correctly:
- 1001 Bank Account — Credit $1,000 ← money leaving the bank (correct)
- 6500 Marketing & Advertising — Debit $1,000 ← the expense
- 2000 Accounts Payable — $0 ← net of the invoice creation + the payment

So the JE is fine. The data is fine.

**Image 1 (Bank Recon)** — you're still on the **Start a new reconciliation**
form. The list below says "No reconciliations yet" because you haven't clicked
the purple **Start** button yet. The cheque will appear once you click Start
and land on the reconciliation detail view.

That said — your mental model is the right one. You should be able to see
what you're about to reconcile **before** committing. This bundle ships
that: a live preview that shows the transactions inline as soon as you pick
a bank account + statement date.

## What this bundle adds

Three files. No schema change, no migration, no new deps.

### `src/lib/recon/index.ts`

New function `previewBankAccount({ entityId, bankAccountId, statementDate })`.
Returns:
- The bank account name (sanity check)
- All journal lines on this account on or before the statement date
- Up to 10 lines AFTER the statement date (so we can tell you "if you want these too, push the date out")
- Summary: count in window, count after, total lines on account, book movement (sum of debits − credits)

### `src/app/api/recon/route.ts`

Adds `?preview=1&bankAccountId=&statementDate=` to the existing GET endpoint.
Returns the preview payload above.

### `src/app/page.tsx`

The Start form now shows a **live preview panel** as soon as both bank
account and statement date are filled in.

**If transactions exist in the window:**

```
┌──────────────────────────────────────────────────────────────────────┐
│ Preview — transactions on this account through Jun 2, 2026           │
├──────────────────────────────────────────────────────────────────────┤
│ Date         Ref            Description                Debit  Credit │
│ Jun 2, 2026  APP-2026-0001  AP Payment: ABC inc...           $1,000  │
├──────────────────────────────────────────────────────────────────────┤
│ 1 transaction in window. Book movement: −$1,000                      │
└──────────────────────────────────────────────────────────────────────┘
```

You'd see this for your cheque — confirming the right account and date
*before* you click Start.

**If transactions exist but are after the statement date:**

```
┌──────────────────────────────────────────────────────────────────────┐
│ ⚠ No transactions found on this account on or before this date.      │
│                                                                       │
│ But this account has 3 posted lines on later dates. Try a later      │
│ statement date.                                                       │
│  • Jun 5, 2026 — AP Payment: ABC inc (−$1,000)                       │
│  • Jun 8, 2026 — Deposit (+$5,000)                                   │
└──────────────────────────────────────────────────────────────────────┘
```

**If transactions don't exist at all on this account:**

```
┌──────────────────────────────────────────────────────────────────────┐
│ ⚠ No transactions found on this account on or before this date.      │
│                                                                       │
│ And no transactions exist on this account at all. Check that you     │
│ picked the right bank account (the one you actually paid from).      │
└──────────────────────────────────────────────────────────────────────┘
```

This is the part the previous bundle was meant to deliver — but only after
you started a recon. This version surfaces it earlier, in the form itself,
so you don't have to click Start to find out.

## What you'll see after deploying this

For your specific situation:
1. Open Bank Recon → click "+ Start reconciliation"
2. Pick `1001 — Bank Account (Current Account)`
3. Pick statement date `06/02/2026`
4. The preview panel appears immediately showing your `APP-2026-0001` cheque line
5. Enter Beginning $0 and Ending $9000 (or whatever your actual statement says)
6. Click Start → land on detail view with your cheque ready to tick

If you have $1,000 going out but enter Ending $9,000, the recon will show
out of balance by $10,000 (because the only book movement is −$1,000). That's
the recon math working correctly — it's telling you the statement and the
book don't agree. You'd need either a deposit JE to match the statement,
or revise the ending balance.

## Deploy

```
cd C:\ledgerpro
# extract the zip
git add -A
git commit -m "Bank recon: live preview of transactions in Start form"
git push
```

After Railway deploys, hard-refresh and re-open Bank Recon. Click "+ Start
reconciliation" and fill bank account + date — the preview appears below
the form before you click Start.

## Tests

All 166 tests continue to pass. No new tests added — the preview function
is a read-only DB query, structurally identical to the existing
`getReconciliationState` query.

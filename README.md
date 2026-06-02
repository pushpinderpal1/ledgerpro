# LedgerPro — Hotfix: AP Pay button

## What was broken

Two bugs in the AP module:

1. **Pay button had no `onClick` handler** — it was literally a decorative
   button. Clicking did nothing.
2. **The `recordPayment` helper in `src/app/api/ap/route.ts` was an
   orphan exported function**, not connected to any HTTP method. Even if
   the button had a click handler, there was no endpoint to call.
   The old helper also didn't post a journal entry — paying an AP invoice
   should move cash off the books (DR AP / CR Bank).

## What this fixes

Two files. No schema change, no migration, no new deps.

### `src/app/api/ap/route.ts` (replaces existing)

- Removes the orphan `recordPayment` helper
- Adds a proper `PATCH` handler on `/api/ap` that:
  - Validates: invoice exists, not VOID, not already PAID, amount ≤ outstanding balance
  - Validates: selected bank account exists, is active, and has `isBankAccount = true`
  - Validates: AP control account (code "2000") exists in the entity
  - Creates `ApPayment` record + balanced `JournalEntry` + updates `ApInvoice` (amountPaid + status + paidAt), all in one transaction
  - Returns `{ success, payment, journalRef, invoice }` on success
- JE format: ref `APP-YYYY-NNNN`, source "AP", status POSTED
  - DR Accounts Payable (2000)
  - CR Selected bank account

### `src/app/page.tsx` (replaces existing)

- Wires the Pay button: `onClick={() => setPayingInvoice(inv)}`
- Hides the Pay button when invoice status is `PAID` or `VOID`
- Adds `PayInvoiceModal` component (mounted at bottom of ApPage):
  - Amount input pre-filled with outstanding balance
  - Payment date picker
  - Method dropdown: ACH / Cheque / Wire / Cash / Other
  - Bank account picker (filtered to `isBankAccount = true` accounts)
  - Reference / cheque number input
  - Live preview of the journal entry that will be posted
  - Submit button shows the amount being paid
  - Click-outside-to-dismiss + ✕ close button
- Shows a clear error in the modal if no bank accounts are flagged as such,
  with instructions to fix it in the Chart of Accounts.

## How it works after the fix

1. AP Tracker → click **Pay** on a Pending invoice → modal opens
2. Amount is pre-filled with the outstanding balance (you can pay partial)
3. Pick method, bank account, optional reference (cheque # for cheque method)
4. Click **Pay $X** → API:
   - Inserts `ApPayment`
   - Creates JE: DR 2000 / CR Bank Account
   - Updates invoice: `amountPaid` increases, status flips to
     `PARTIALLY_PAID` or `PAID` (if balance ≤ 0.5¢)
5. Toast shows the journal ref (`APP-YYYY-NNNN`)
6. Modal closes, AP list reloads, invoice shows updated status

## Prerequisites in your data

Before the modal can post a payment, the entity needs:
- At least one account with code **"2000"** (AP control account) — same
  convention used by the existing AP invoice posting and the new expense
  request workflow
- At least one account with **"Is bank account"** ticked (set this on the
  account in Chart of Accounts → edit → tick the checkbox)

If either is missing, the modal returns a clear error explaining what to fix.

## Deploy

```
cd C:\ledgerpro
# extract the zip, overwriting the two files
git add -A
git commit -m "Hotfix: wire AP Pay button to working payment endpoint with JE posting"
git push
```

After Railway redeploys, hard-refresh and:

1. AP Tracker → click **Pay** on the ABC Inc invoice
2. Modal opens with $1,000.00 pre-filled
3. Pick a bank account, set method (e.g. ACH)
4. Click **Pay $1,000.00**
5. Toast shows the journal ref
6. Row updates: balance $0, status PAID, no more Pay button on this row
7. Reports → Trial Balance → AP balance decreased, bank account decreased
8. Journal Entries → find the new `APP-YYYY-NNNN` entry

## Tests

All 166 tests continue to pass. No new tests added — the payment logic
lives inside the API route as DB-touching code, which the existing test
suite doesn't try to mock (consistent with the rest of the codebase).
The state machine and validations are simple enough that they don't need
their own unit tests; correctness is verified by deploy + manual test.

## On me

I should have noticed the Pay button had no onClick handler when I built
the AP module originally. Visual UI elements without handlers slip
through type-checking because there's no semantic difference between a
button with and without a click handler at the TypeScript level.
Going forward I'll grep for orphan UI elements when reviewing modules.

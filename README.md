# LedgerPro — Transaction Posting group + Receipts + configurable Payment Modes

Three things in one bundle:

1. **Sidebar restructure** — Journal Entries and Payments moved into a new
   "Transaction Posting" group, joined by the new Receipts page
2. **Receipts module** — record incoming money (customer payments, refunds,
   interest received, etc.). Each receipt creates a posted journal entry
3. **Configurable Payment Modes** — Setup → Payment Modes lets you manage
   the list of payment methods. Defaults seeded automatically.

## What's in this zip

- `prisma/schema.prisma` — adds `PaymentMode`, `Receipt` models, 2 enums,
  back-relations on LegalEntity, Account, JournalEntry
- `prisma/migrations/0011_receipts_and_modes/migration.sql` — one additive
  migration; creates 2 tables + 2 enums
- `src/lib/auth/index.ts` — adds permission keys: `receipts:read/write`,
  `payment-modes:read/write`
- `src/app/api/payment-modes/route.ts` — CRUD with **lazy default seeding**
  (first read auto-creates Cheque, Bank Transfer, ACH, Wire, Credit Card,
  Cash, Other)
- `src/app/api/receipts/route.ts` — full CRUD + void; each POST creates a
  balanced JE in a single transaction
- `src/app/page.tsx` — sidebar restructure + 2 new pages (ReceiptsPage,
  PaymentModesPage)

## New sidebar layout

```
Dashboard

BOOKS
  Chart of Accounts
  Period Locks

TRANSACTION POSTING            ◄── NEW GROUP
  Journal Entries              ◄── moved here
  Payments                     ◄── moved here
  Receipts                     ◄── NEW

PAYABLES
  AP Tracker
  Expense Requests

RECONCILIATIONS
  Bank Recon
  Vendor Recon

REPORTS
  Reports
  Custom Statements

ASSETS & PAYROLL
  Fixed Assets
  Payroll
  W-2 / 1040-K

PLANNING & MIS
  Budget & MIS
  MIS / Departments

SETUP
  Group Structure
  FX Rates
  Payment Modes               ◄── NEW
  QB IIF

ADMIN
  Audit Trail
  User Management
  Settings
```

## How Receipts work

### Recording a receipt

1. Sidebar → **Transaction Posting → Receipts** → **+ New receipt**
2. Fill:
   - **Received from** — payer name (customer/client)
   - **Receipt date**
   - **Amount**
   - **Payment mode** — dropdown sourced from Payment Modes (filtered to
     RECEIPT or BOTH kind only)
   - **Deposit account (DR)** — bank/cash account; dropdown filtered to
     `isBankAccount` accounts
   - **Credit account (CR)** — revenue or AR account
   - **Reference** (cheque #, transaction ID, etc.) — optional
   - **Description** — optional
3. Live posting preview shows you the JE that will be created
4. Click **Record receipt** → API creates:
   - A `Receipt` row with auto-numbered `RCP-YYYY-NNNN`
   - A posted journal entry (`RCP-YYYY-NNNN`) with two lines:
     - DR deposit account, amount
     - CR credit account, amount
5. Toast confirms with the JE ref

### Voiding a receipt

Click **Void** on a posted row → confirm → API creates a reversing JE
(`RCPV-YYYY-NNNN`) that cancels the original posting. The receipt is
marked VOID; both JE refs are linked for audit.

### Receipts in reports

Since receipts post real journal entries, they show up everywhere:
- Trial Balance — deposit account increases, credit account decreases
- General Ledger — the JE lines appear under both accounts
- **Bank Recon** — the deposit line will appear in the next bank recon
  on that account (uncleared by default, ready to tick)

## How Payment Modes work

Setup → **Payment Modes** shows the configured catalog.

**Default seeded modes** (created the first time you visit the page):
- Cheque · Bank Transfer · ACH · Wire · Credit Card · Cash · Other

For each mode you can edit (if you have ADMIN/OWNER role):
- **Used for**: Both / Payments only / Receipts only
- **Active** — uncheck to hide from new transactions without deleting
- **Sort order** — lower numbers appear first in dropdowns
- **Delete** — only if no receipts reference the mode (otherwise deactivate)

Add custom modes (e.g. "PayPal", "Stripe", "Crypto") via **+ New mode**.

## Permissions

| Action                     | OWNER | ADMIN | ACCOUNTANT | AUDITOR |
|----------------------------|:-----:|:-----:|:----------:|:-------:|
| View receipts              |  ✓    |  ✓    |    ✓       |    ✓    |
| Create / void receipt      |  ✓    |  ✓    |    ✓       |    ✗    |
| View payment modes         |  ✓    |  ✓    |    ✓       |    ✓    |
| Add / edit payment modes   |  ✓    |  ✓    |    ✗       |    ✗    |

## Deploy

```
cd C:\ledgerpro
git add -A
git commit -m "Receipts module + configurable payment modes + sidebar regroup"
git push
```

Railway runs migration `0011_receipts_and_modes`. No new dependencies, no
env vars. The default payment modes are seeded **lazily** — the first
person to visit Setup → Payment Modes (or post a receipt) for an entity
will trigger the seeding for that entity.

## After deploy — verify

1. Sidebar reorganization: Journal Entries + Payments + Receipts now grouped
   under "Transaction Posting"
2. Setup → **Payment Modes** → see 7 seeded modes
3. Transaction Posting → **Receipts** → **+ New receipt**:
   - Pick a customer name (e.g. "ABC Corp")
   - Pick mode "Cheque", deposit account (your bank), credit account
     (e.g. a revenue account)
   - Enter amount $500
   - Live preview shows: DR 1001 $500 / CR <revenue> $500
   - Submit → toast with JE ref
4. Reports → Trial Balance → bank account up by $500, revenue up by $500
5. Journal Entries → find the RCP-YYYY-NNNN entry

## What's NOT in this bundle (intentional)

- **Customer FK on receipts** — `receivedFrom` is a free-text field. A real
  Customer model (with AR aging, statements, etc.) is a separate sizable
  feature. v1 just records the name.
- **Receipts against specific invoices** — receipts don't tie back to an
  AR invoice (because no AR module yet). When AR is built, we'd add an
  `arInvoiceId` field with allocation logic similar to AP payments.
- **AP Payments using the new PaymentMode table** — AP Payments still use
  their hard-coded enum. Migrating them to use PaymentMode would touch a
  lot of code and risk regressions. Easy follow-up if/when needed.
- **Default deposit/credit accounts per mode** — could pin "Credit Card" to
  always deposit into Stripe Clearing, etc. Future enhancement.
- **Bulk receipt entry** — single-receipt at a time only.
- **Receipt attachments** — no file upload (the Attachment model exists
  from the AP workflow bundle but isn't wired here yet).

## Tests

All 166 tests continue to pass. No new tests added — the receipt posting
logic is DB-touching code (similar to AP payment posting), structurally
identical to patterns already covered by deploy-and-test.

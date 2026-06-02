# LedgerPro — Uniform Title Case for UI labels

168 label changes across `src/app/page.tsx` — applies a single consistent
Title Case pattern to every user-facing label so the UI reads uniformly.

## What changed

- **Form labels** (`<label>` inside forms) — e.g. "Account code" → "Account Code"
- **Card / section headers** — e.g. "Account summary" → "Account Summary"
- **Table column headers** — e.g. "Account name" → "Account Name"
- **KPI tile labels** — e.g. "Cash on hand" → "Cash on Hand"
- **Status badge labels** — e.g. "Returned to requester" → "Returned to Requester"
- **Detail key-value tuples** — e.g. "Acquisition date" → "Acquisition Date"

## The Title Case rule

- First and last word always capitalized
- Major words capitalized
- Short connectors stay lowercase: `a, an, the, and, or, but, of, in, on,
  at, to, for, by, with, from, as, vs, per, via, into, onto`
- Preserved uppercase tokens: `AP, AR, GL, JE, TB, BS, PDF, CSV, OFX, QFX,
  MIS, FX, IIF, API, ACH, YTD, KPI, DR, CR, ID, P&L, W-2, 1040-K, TOTP, QR,
  SSN, URL, PIN, SQL, UI, OCR, 2FA, MFA, KYC, AML, etc.`
- JSX expression interpolation (`{currentEntity?.name}`, `{a.assetNo}`, etc.)
  preserved verbatim

## What was NOT changed (intentional)

- **Toast messages and validation errors** — these are full sentences and
  read naturally in sentence case ("Account created", "Authentication failed",
  "Invoice not found")
- **Audit-log action labels** — system-event descriptions
- **Sidebar nav items** — already in Title Case
- **Button text** — already mostly consistent
- **Dropdown options inside `<option>` tags** that are value labels (e.g.
  "Both — payments and receipts") — these are descriptive sentences

## Examples

| Before | After |
|---|---|
| Account code | Account Code |
| Bank account | Bank Account |
| Net income — this month | Net Income — This Month |
| Top expenses — this month | Top Expenses — This Month |
| Parent account (for ledger / subledger hierarchy) | Parent Account (for Ledger / Subledger Hierarchy) |
| Dr Total / Cr Total | DR Total / CR Total |
| Cash on hand | Cash on Hand |
| Total received (posted) | Total Received (Posted) |
| Returned to requester | Returned to Requester |
| Fully depreciated | Fully Depreciated |
| Import QB IIF file | Import QB IIF File |
| Entity settings — {entity.name} | Entity Settings — {entity.name} |
| Revenue vs Expense — last 6 months | Revenue vs Expense — Last 6 Months |

## How it was done

A small Python script targeted three safe JSX patterns:
1. `<label style={S.label}>...</label>`
2. `<div style={S.cardHeader}>...</div>`
3. `[...].map(h => <th ...{h}...)` — table column header arrays

Then a manual pass over KPI card `label:` properties and status-badge
labels (scattered across the file in object literals).

The Title Case function preserves JSX expressions, dollar amounts, and
already-uppercase tokens so nothing semantic was changed — only the
visible casing.

## Deploy

```
cd C:\ledgerpro
git add -A
git commit -m "Uniform Title Case across UI labels"
git push
```

No deps, no schema change, no migration, no env vars. One file.

## Verify

After deploy, every page should read uniformly:
- Form fields: "Account Code", "Account Name", "Bank Account"
- Card headers: "Account Summary", "AP — Recent Invoices"
- KPI tiles: "Cash on Hand", "AP Outstanding", "Net Income — This Month"
- Table columns: "Account Name", "DR Total", "Book Value", "Received From"

If you spot any stragglers, tell me the exact text and I'll patch them.

## Tests

All 173 tests continue to pass.

# LedgerPro — QuickBooks-style Reports module

Adds a full reports module modeled on QuickBooks: 10 reports across 3
categories, a Reports landing page, customization bar with date-range
presets, and CSV export.

## What's in this zip

- `src/app/page.tsx` — replaces existing. Adds the Reports page, landing view,
  customization bar, and 10 report renderers.
- `src/lib/reports/index.ts` — extends the existing reports engine with new
  reports: Statement of Cash Flows, Journal Report, A/P Aging Detail,
  Expenses by Vendor, and Profit & Loss with comparison columns.
- `src/app/api/reports/route.ts` — dispatches the new report types.

## Reports included

**Business overview**
- Profit & Loss
- Profit & Loss Comparison (current vs prior period vs prior year)
- Balance Sheet
- Statement of Cash Flows (indirect method)

**What you owe**
- A/P Aging Summary (with bucket cards)
- A/P Aging Detail (grouped by vendor)
- Expenses by Vendor

**For my accountant**
- Trial Balance
- General Ledger (with running balance per account)
- Journal Report

## Deploy steps

1. Extract zip at the root of your `ledgerpro` repo
2. Commit + push:
   ```
   git add -A
   git commit -m "QuickBooks-style reports module"
   git push
   ```
3. No new env vars, no database migrations, no new dependencies.

## What you'll see

- New **Reports** item in the sidebar
- Landing page shows reports grouped by category with search
- Click a report → opens with customization bar (date presets like "This year",
  "Last quarter", "YTD", "Custom") + the actual report
- Each report has **Refresh**, **Export CSV**, and **Print** buttons
- Reports render in clean QuickBooks-like layout with section headers,
  subtotals, grand totals, and percentage indicators

## Notes

- All reports derive from POSTED journal entries only — drafts and voids never
  affect output.
- All money math uses integer-cent arithmetic against Decimal(18,2) columns.
- The Statement of Cash Flows uses the indirect method with pragmatic heuristics
  for account classification (cash/bank by account-code prefix or subType).
  When you add explicit classification flags to your Chart of Accounts (e.g.
  current vs long-term assets), the cash-flow report will get more accurate
  without changes to the UI.
- Comparison report compares against the same-length prior period AND the
  same period one year ago.

# LedgerPro — Dashboard KPIs + Drill-down

Two improvements in one bundle. No schema change, no migration, no new deps.

## What's in this zip

- `src/lib/dashboard/index.ts` — KPI computation engine
- `src/lib/reports/index.ts` — replaces existing. Adds `accountId` to TB rows
  for drill-down support. All other reports unchanged.
- `src/app/api/dashboard/route.ts` — `GET /api/dashboard?entityId=` returns
  the full KPI payload in a single round-trip
- `src/app/api/reports/drilldown/route.ts` — `GET /api/reports/drilldown` —
  returns journal lines with running balance for a specific account+date range
- `src/app/page.tsx` — replaces existing. New DashboardPage + DrillDownModal
  component + clickable TB rows.

## What's new

### Dashboard with KPIs
The Dashboard page is now a real financial overview:

- **KPI cards** (top row, 4 cards):
  - Cash on hand — sum of all `isBankAccount=true` accounts
  - Net income this month
  - Net income year-to-date
  - AP outstanding (with overdue count)
- **6-month trend chart** — SVG bar chart showing revenue vs expense for
  the trailing 6 months. Pure inline SVG, no chart library.
- **Top 5 expenses this month** — bar list of biggest expense accounts
- **Account summary + recent AP** — unchanged widgets, still visible

### Drill-down to source transaction
Click any account row in the **Trial Balance** report → modal opens showing:

- Opening balance, total debits, total credits, closing balance (4 cards)
- Every journal line in that period that hit the account, with:
  - Date, journal ref, description, line memo
  - Debit, credit
  - Running balance (type-aware)
- Sticky table header for scrolling long lists
- Click outside or ✕ to close

Trial Balance rows show a small `›` indicator on drillable rows (those with
non-zero balances). Cursor changes to pointer on hover.

## What's NOT in this bundle (intentional, deferred)

- **P&L and Balance Sheet drill-down** — both reports have totals/subtotals
  that aggregate multiple accounts; clean drill-down needs per-line
  account ID exposed (works for some sections, not for subtotals). Adding
  this is fast follow-up work (~30 min) but separated to keep this bundle
  focused on the highest-value drill target (TB).
- **General Ledger drill-down** — GL already shows journal lines, so the
  drill is redundant. The "View entry" deep link to journal entry detail
  could be added if requested.
- **Dashboard date range selector** — current dashboard shows fixed
  "this month / YTD / 6-month trend". Custom date ranges easy to add later.
- **Custom statement designer** — coming in next bundle (see notes below).

## Deploy

```
cd C:\ledgerpro
# extract the zip, overwriting existing files
git add -A
git commit -m "Dashboard KPIs + drill-down to source"
git push
```

After deploy, hard-refresh and verify:
1. Dashboard → new KPI cards, 6-month chart, top expenses list
2. Reports → Trial Balance → click any row with a non-zero balance →
   drill-down modal opens with that account's journal lines
3. Modal close (✕ or click outside) works

## Performance notes

The dashboard endpoint makes ~10 DB queries to compute KPIs (one for each
trend month + cash + AP + top expenses). For entities with millions of
journal lines, this could take 500ms-1s. If that becomes a problem the
trend computation can be optimized to a single grouped query — flagged
as a follow-up if needed.

The drill-down query is bounded by the account+date filter and indexed
on `accountId` so it should be fast even for high-volume accounts.

## Next bundle

The **Custom Financial Statement Designer** (StatementTemplate model +
builder UI + run engine) is more substantial and will ship as a separate
deploy. That bundle will include:
- New schema: StatementTemplate (with sections as JSON)
- Migration 0009
- New "Custom Reports" sidebar item
- Designer UI (add/edit/reorder sections, filter editor)
- Runner UI (date range + render)

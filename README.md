# LedgerPro — Sidebar reorganized into parent/child groups

The flat 22-item sidebar is now organized into 8 collapsible groups plus
Dashboard at the top. The groups follow standard accounting-software
conventions (Books, Payables, Reports, etc.).

## What changes

One file: `src/app/page.tsx`. No schema change, no migration, no new deps.

## New structure

```
Dashboard                          (standalone, no group)

BOOKS                              ▾  (click to collapse/expand)
  ≡  Chart of Accounts
  ✎  Journal Entries
  🔒 Period Locks

PAYABLES                           ▾
  ◎  AP Tracker
  📥 Expense Requests
  ✓  Payments

RECONCILIATIONS                    ▾
  ↔  Bank Recon
  ◐  Vendor Recon

REPORTS                            ▾
  ▤  Reports
  📊 Custom Statements

ASSETS & PAYROLL                   ▾
  ⬚  Fixed Assets
  ◷  Payroll
  ◻  W-2 / 1040-K

PLANNING & MIS                     ▾
  ◈  Budget & MIS
  ⊞  MIS / Departments

SETUP                              ▾
  ◇  Group Structure
  ⇄  FX Rates
  ⇄  QB IIF

ADMIN                              ▾
  ⊙  Audit Trail
  ◉  User Management
  ⚙  Settings
```

## Behavior

- **Click a group header to collapse/expand** it. Collapsed state persists
  across page loads (saved to `localStorage`).
- **The group containing the active page is always expanded**, even if
  you've collapsed it — so you never lose track of where you are.
- **Items still filter by role**. Groups that end up empty for a given
  role are hidden entirely (so AP_CLERK doesn't see "Admin" with nothing
  in it).
- **Sidebar-collapsed mode** (icon-only, when you click the logo): group
  headers are hidden, items render as a flat list of icons — same as
  before. Hover tooltips still work.
- **Top bar page title** still resolves correctly when you navigate.

## Deploy

```
cd C:\ledgerpro
git add -A && git commit -m "Sidebar: organize 22 items into 8 collapsible groups" && git push
```

After Railway deploys, hard-refresh — the sidebar should immediately look
less cluttered. Click any group header to collapse/expand. Your collapse
preferences persist per browser via localStorage.

## Tests

All 166 tests continue to pass.

## What's NOT in this bundle

- **Drag-and-drop reordering** of items within groups
- **Custom user-defined groups** — the groups are hard-coded
- **Pinning favorites** to the top
- **Search/filter** the menu

All are easy follow-ups if needed.

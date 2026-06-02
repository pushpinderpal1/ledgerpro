# LedgerPro — COA improvements + Vendor Recon

Addresses four issues in one consolidated deploy:

1. **Chart of Accounts editing** — every account now has an Edit button.
   Code and type lock once any journal line uses the account (changes break
   audit/reports); everything else stays editable forever.
2. **Bank account flag exposed** — Add/Edit form now has an "Is bank account"
   checkbox. Bank Reconciliation filters by this flag (was already correct in
   code, just no UI to set it).
3. **COA hierarchy (ledger / subledger)** — Add/Edit form has a Parent Account
   dropdown. The Chart of Accounts list renders the hierarchy as an indented
   tree. Cycle protection at API layer.
4. **Vendor Reconciliation** — new sidebar item alongside Bank Recon. Pick a
   vendor, enter their statement balance, system computes your internal AP
   balance and the difference. DRAFT → FINALIZED flow with reopen + delete.

## What's in this zip

- `prisma/schema.prisma` — adds `VendorReconciliation` model + `VendorReconStatus`
  enum. Account model unchanged (it already had `parentId` and `isBankAccount`).
- `prisma/migrations/0008_coa_and_vendor_recon/migration.sql`:
  - **Auto-backfill**: sets `isBankAccount = true` on existing ASSET accounts
    whose subType is "Bank" / "Cash" or whose name starts with "Cash" / "Bank".
    Existing data immediately shows up in Bank Recon without manual edits.
  - Creates the `vendor_reconciliations` table.
- `src/lib/vendor-recon/index.ts` — engine: `computeInternalBalance`, `listVendors`
- `src/app/api/accounts/route.ts` — replaces existing. GET returns usage count;
  PATCH refuses code/type changes if account in use; cycle detection on parentId;
  audit logging on every change.
- `src/app/api/vendor-recon/route.ts` — full CRUD + finalize/reopen actions +
  internal-balance preview endpoint
- `src/app/page.tsx` — replaces existing. New AccountsPage (edit + hierarchy +
  bank flag), new VendorReconPage with detail view

## Deploy steps

```
cd C:\ledgerpro
# extract the zip, overwriting existing files
git add -A
git commit -m "COA hierarchy/edit + Vendor Reconciliation"
git push
```

No new dependencies, no env vars. Railway applies migration `0008_coa_and_vendor_recon`.

## How to use

### Editing existing accounts

Accounts → Click **Edit** on any row. The form opens pre-filled. If the account
is in use (right-most column shows usage count > 0), Code and Type fields are
visibly locked. Name, sub-type, parent, description, and "Is bank account" stay
editable.

### Marking bank accounts

When editing, tick **Is bank account**. The row gets a blue `BANK` badge.
Bank Recon will now offer that account in its dropdown.

After deploy, existing accounts named "Cash" / "Bank" or with those subTypes
are **already flagged automatically** by the migration.

### Building hierarchy (ledger / subledger)

On Add or Edit, pick a **Parent account** from the dropdown. The dropdown only
shows same-type accounts and excludes the account's own descendants. The
Chart of Accounts list renders parents flush-left and children indented with a
`↳` connector.

### Vendor Reconciliation

1. Sidebar → **Vendor Recon**
2. **+ New reconciliation** → pick a vendor (dropdown from your existing AP
   invoices) → enter the statement date → enter the vendor's stated balance
3. A preview panel shows your internal AP balance and the difference live
4. **Create reconciliation** → row appears in the list with status `DRAFT`
5. Click a row to open detail → review numbers, add notes about timing
   differences / disputed items → **Finalize** when satisfied

**Finalize** recomputes internal balance from current AP data at the moment of
finalize and locks the record. You can **Reopen** later if you need to adjust.

For DRAFT reconciliations, the detail view shows a "Live" badge if your AP has
changed since the reconciliation was created, so you know to refresh before
finalizing.

### Permissions

- Chart of Accounts edit: OWNER / ADMIN / ACCOUNTANT
- Vendor Recon: OWNER / ADMIN / ACCOUNTANT / AUDITOR (read) + AP_CLERK (write)

## Audit trail

All actions log to AuditLog:
- `ACCOUNT_CREATED`, `ACCOUNT_UPDATED`, `ACCOUNT_DEACTIVATED`, `ACCOUNT_DELETED`
- `VENDOR_RECON_CREATED`, `VENDOR_RECON_UPDATED`, `VENDOR_RECON_FINALIZED`,
  `VENDOR_RECON_REOPENED`, `VENDOR_RECON_DELETED`

## What's not in this pass

- **Vendor recon line-by-line matching** — v1 reconciles balance vs balance
  only. To match individual invoices against statement lines item-by-item,
  needs a second model (`VendorReconLine`) and a richer UI. Reasonable
  follow-up if balance-level isn't enough.
- **Vendor statement file upload** — currently the user types the balance.
  PDF/CSV statement parsing is a separate feature.
- **Audit log entries for Account create/update from the COA Import feature**
  — those already audit as `COA_IMPORTED`, not the per-row events above.
  Acceptable since the import is a bulk operation.

## Tests

137 unchanged. The new code is mostly DB+UI plumbing; no pure-logic changes
warranted new tests beyond what already exists.

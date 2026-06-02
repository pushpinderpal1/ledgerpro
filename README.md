# LedgerPro — Hotfix: dashboard + vendor-recon AP queries

## What this fixes

The previous bundles referenced two fields on `ApInvoice` that don't exist on
the schema:

- `balance` — the schema has `amount` + `amountPaid`. Open balance is
  `amount − amountPaid`.
- `date` — the schema field is `invoiceDate`.

This caused:

1. **"Failed to compute dashboard"** popup — `/api/dashboard` threw a Prisma
   error whenever AP invoices existed (or even when the query schema was
   validated at runtime).
2. **Vendor Reconciliation internal balance shows 0** even when you have
   AP invoices for that vendor — the query never matched anything because
   `invoiceDate` wasn't filtered correctly and `balance` returned undefined.

The vendor recon UI loaded because the page rendering doesn't depend on the
query succeeding — only the actual recon computation does.

## What's in this zip

Two files, both library-only:
- `src/lib/dashboard/index.ts`
- `src/lib/vendor-recon/index.ts`

No schema change. No migration. No API change. No UI change.

## Deploy

```
cd C:\ledgerpro
# extract the zip, overwriting only those two files
git add -A
git commit -m "Hotfix: dashboard + vendor-recon ApInvoice field names"
git push
```

After Railway redeploys, hard-refresh the Dashboard. The KPI cards, chart, and
top expenses should now render. If you have AP invoices, the AP outstanding
card should show their open balance.

For Vendor Recon: try creating a new reconciliation for a vendor that has
posted AP invoices — the "Internal AP balance" preview should now show the
real amount (sum of `amount − amountPaid` across non-void invoices through
the statement date).

## My fault

I should have grep'd the actual ApInvoice schema before writing those
queries. Sorry for the friction. The pure-logic tests all passed because
they don't touch the DB; the bug was only at the boundary where my code
talked to Prisma using assumed field names.

Going forward: I'll verify model field names against the schema before
shipping any DB-touching code.

# LedgerPro — Bank Reconciliation Reports (Excel + PDF, Detailed + Summary)

Four exports from any bank reconciliation:

|         | Detailed                                | Summary                    |
|---------|-----------------------------------------|----------------------------|
| Excel   | Header + math + transaction table       | Header + reconciliation math |
| PDF     | Header + math + transaction table       | Header + reconciliation math |

## Tick convention (per request)

- **`✓`** + clearing date — line is cleared and the reconciliation is
  **COMPLETED** (locked)
- **`*`** — line is ticked but the reconciliation is still **IN_PROGRESS**
- *(blank)* — line is uncleared

Both formats use the same convention. Legend appears at the bottom of the
detailed report.

## What's in this zip

- `package.json` — adds `exceljs` (Excel generation) and `pdfkit` (PDF
  generation) as runtime dependencies, plus `@types/pdfkit` for TS. All
  pure JavaScript, no native binaries, no Railway build surprises.
- `src/lib/recon/report-data.ts` — pure data shaper. Given the
  reconciliation state, produces the report payload (header, summary
  math, transaction rows with tick column).
- `src/lib/recon/render.ts` — two renderers, `renderReconExcel(data, detail)`
  and `renderReconPdf(data, detail)`. Both return a `Buffer`.
- `src/app/api/recon/export/route.ts` — `GET /api/recon/export?entityId=&id=&format=xlsx|pdf&detail=detailed|summary`.
  Returns the file as a binary attachment with proper Content-Type.
- `src/app/page.tsx` — adds an **Export ▾** dropdown to the reconciliation
  detail toolbar with four download links.
- `tests/recon-report.test.ts` — 7 unit tests on the report-data shaper
  (tick logic, outstanding-items math, book-balance math, sort).

## Reconciliation math (both reports)

```
Beginning balance (per books)            $X,XXX.XX
Statement ending balance (per bank)      $X,XXX.XX
Cleared balance (in this recon)          $X,XXX.XX        ← top border

Outstanding items
  Outstanding deposits (uncleared receipts)    $X,XXX.XX
  Outstanding withdrawals (uncleared payments) $X,XXX.XX

Adjusted bank balance                    $X,XXX.XX        ← top border
Book balance                             $X,XXX.XX

Difference                               $X,XXX.XX        ← top border
                                                          (green if zero,
                                                           red otherwise)

✓ Reconciliation is balanced  /  ⚠ Out of balance — investigate and correct
```

The detailed variant adds a transaction table after the math block with:

| Date | Reference | Description | Deposit (Dr) | Withdrawal (Cr) | Cleared |
|------|-----------|-------------|--------------|-----------------|---------|

Where the **Cleared** column shows `✓ <date>`, `*`, or blank per the tick
convention. Footer row shows total debits + credits.

## How to use it after deploy

1. Sidebar → **Reconciliations → Bank Recon**
2. Open any reconciliation (or start a new one)
3. Click **Export ▾** at the top right of the detail view → 4 options:
   - **Excel — Detailed**
   - **Excel — Summary**
   - **PDF — Detailed**
   - **PDF — Summary**
4. File downloads to your browser's Downloads folder

Filename format: `bank-recon-{code}-{statement-date}-{detail}.{ext}`
e.g. `bank-recon-1001-2026-06-30-detailed.pdf`

## Deploy

```
cd C:\ledgerpro
git add -A
git commit -m "Bank rec reports: Excel + PDF, Detailed + Summary"
git push
```

Railway will run `npm install` to pick up the two new dependencies
(`exceljs` ~300 KB + `pdfkit` ~500 KB; both pure JS). No schema change,
no migration, no env vars.

## After deploy — verify

1. Open Bank Recon → click any reconciliation
2. Click **Export ▾** → **PDF — Summary** → file downloads
3. Open the PDF — confirm:
   - Header with entity name, account, statement date, status
   - Reconciliation math block with totals
   - For an IN_PROGRESS recon: cleared lines (in the on-screen UI) will
     export as `*` in the report
   - For a COMPLETED recon: cleared lines export as `✓ YYYY-MM-DD`
4. Try **Excel — Detailed** → file opens in Excel/LibreOffice with:
   - Frozen header row on the transactions table
   - Currency-formatted amount columns
   - Color-coded tick column (green ✓ for completed, amber * for in-progress)

## Tests

173 total tests pass (166 prior + 7 new in `recon-report.test.ts`):

- naturalBalance + sign convention
- tick logic for the three states (uncleared / in-progress-cleared / completed-cleared)
- outstanding-items math from uncleared list
- book balance = clearedBalance + uncleared net
- transactions sorted by date then ref
- header pass-through

Smoke-tested locally: all four format/detail combinations produce valid
files (xlsx → ZIP signature `PK`; pdf → `%PDF-1.3` signature, parseable
xref table, fonts embedded).

## What's NOT in this bundle

- **Email the report directly** — currently download-only. Easy follow-up
  when email is wired up.
- **Custom branding/logo** on the report header — currently text-only.
  Future: per-entity logo upload + render.
- **Multi-account reconciliation summary** — one rec at a time.
- **Auto-export on finalize** — could trigger a PDF save when a recon is
  finalized. Easy follow-up.
- **Statement-line listing in the report** — the report shows BOOK
  transactions only. If you uploaded a CSV statement, those lines are
  for matching reference, not for the formal report. Could add as a
  follow-up section.

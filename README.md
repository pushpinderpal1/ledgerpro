# LedgerPro — Hotfix: swap pdfkit → pdf-lib (Railway build fix)

## What was wrong

`pdfkit` pulls in `fontkit` as a transitive dependency, and `fontkit`
depends on `brotli` — a package with **native C code** that famously fails
to compile in Railway's Nixpacks build environment. This is a well-known
issue in the broader `pdfkit` ecosystem and the previous next.config
hotfix (marking `pdfkit` as external) didn't help because the failure
happens during `npm install` itself, before webpack ever runs. That's why
your Railway build died in ~17 seconds.

I went down the path of patching pdfkit specifically. The cleaner fix is
to use a different PDF library that doesn't depend on any native code.

## What this fixes

Three files. No schema change, no migration.

### `package.json`
- Removes `pdfkit` and `@types/pdfkit`
- Adds `pdf-lib` (`^1.17.1`) — pure JS, zero native dependencies, widely
  used in Next.js / Vercel deployments. Adds 4 packages instead of the
  208 that pdfkit pulled in.

### `next.config.js`
- Removes `pdfkit` from `serverComponentsExternalPackages` (no longer needed)
- Keeps `exceljs` in there (it's a server-only Node package that benefits
  from being externalized)

### `src/lib/recon/render.ts`
- Same public API: `renderReconPdf(data, detail)` returns a `Buffer`
- Same visual output: header, reconciliation math block, transactions
  table with totals, legend at bottom
- Rewritten internally to use `pdf-lib`'s coordinate-based drawing API
- **Tick mark handling**:
  - For COMPLETED rec: uses ZapfDingbats (a standard PDF font designed for
    symbols) to render a real ✓ glyph in green, followed by the clearing
    date in Helvetica
  - For IN_PROGRESS rec: renders `*` in amber
  - These appear in the transactions table's "Cleared" column AND in
    the legend at the bottom
- "Reconciliation is balanced" message: real ✓ glyph + green text
- "Out of balance" message: `[!]` prefix + red text (the ⚠ symbol isn't in
  any PDF standard font; bracketed exclamation is the conventional substitute)

## Verified locally

- `next build` completes the webpack compilation step successfully (the
  later Prisma error in my sandbox is unrelated — Railway has the Prisma
  engine binary)
- Smoke test generates all four file variants:
  - xlsx detailed (8097 bytes)
  - xlsx summary  (7589 bytes)
  - pdf detailed  (2926 bytes)
  - pdf summary   (2189 bytes)
- All four open cleanly as valid files (xlsx = ZIP "PK", pdf = "%PDF-1.3")
- All 173 tests continue to pass

## Deploy

```
cd C:\ledgerpro
# extract the zip — overwrites package.json, next.config.js, render.ts
git add -A
git commit -m "Hotfix: swap pdfkit for pdf-lib to fix Railway build"
git push
```

Railway runs `npm install` again with the new dependency set. No more
brotli/fontkit native compilation. The build should succeed and the recon
export feature will be live.

## After deploy — verify

1. Bank Recon → open any reconciliation → click **Export ▾**
2. Click **PDF — Detailed** → file downloads
3. Open the PDF — confirm:
   - Title "Bank Reconciliation Statement" centered at top
   - Entity name, account, statement date, status all rendered
   - Reconciliation math block with green or red Difference
   - Transactions table with tick marks in the Cleared column:
     - Completed recon: green ✓ glyph + clearing date
     - In-progress recon: amber `*`
   - Legend at the bottom explaining the tick convention
4. Try **PDF — Summary** for the shorter variant
5. Excel variants are unchanged from the previous bundle

## On me

I should have caught the brotli/native-deps issue when adding pdfkit. The
clue was the deprecation warnings during `npm install` — old packages with
native code are a red flag for Railway/serverless builds. Going forward
I'll prefer pure-JS alternatives for any Node-only utility libraries,
especially anything pulling in fonts/parsers.

# LedgerPro — Hotfix: complete pdfkit→pdf-lib swap (includes lock file)

## What actually went wrong

My previous "swap pdfkit → pdf-lib" hotfix only shipped `package.json`. I
forgot that **`package-lock.json` is the file Railway actually uses** to
install dependencies (via `npm ci`). Your lock file on disk was still
locked to pdfkit + fontkit + brotli from the original deploy, even though
your `package.json` was up to date.

Result: Railway followed the old lock file, tried to install `brotli`
(which fontkit depends on), the native C compilation failed, and the
whole build died — same symptom as before, with the actual fix never
reaching the install step.

This is on me. When swapping dependencies I should always ship both
`package.json` AND `package-lock.json` together. Going forward I'll
default to bundling both.

## What this includes

Four files (only one new from the previous hotfix):

- **`package-lock.json`** ← THE FIX. 96 KB. Clean lock file with:
  - 0 references to `pdfkit`
  - 0 references to `fontkit`
  - 0 references to `brotli`
  - 1 reference to `pdf-lib` (the replacement)
  - exceljs entries intact
- `package.json` — same as the previous hotfix (no pdfkit, has pdf-lib)
- `next.config.js` — same as the previous hotfix (exceljs in
  serverComponentsExternalPackages)
- `src/lib/recon/render.ts` — same as the previous hotfix (pdf-lib-based
  PDF rendering with ZapfDingbats tick marks)

## Deploy

```
cd C:\ledgerpro
# extract the zip — overwrites all four files including package-lock.json
git add -A
git commit -m "Hotfix: sync package-lock.json — remove pdfkit/fontkit/brotli"
git push
```

Railway will now run `npm ci` against a clean lock file. No more brotli
native compilation attempt. The install step should take ~30 seconds
instead of dying at 17.

## Verify after deploy

1. Build logs should show successful `npm install` / `npm ci`
2. After deploy, Bank Recon → open any reconciliation → click **Export ▾**
3. Click **PDF — Detailed** → file downloads
4. Open the PDF — confirm tick marks render correctly:
   - Completed recon: green ✓ + clearing date in the Cleared column
   - In-progress recon: amber `*`

## What's NOT in this bundle

Nothing new beyond the lock file. The pdf-lib swap and ZapfDingbats tick
rendering were already shipped in the previous hotfix; this just makes
them actually installable on Railway.

## Lessons learned (for me)

1. **Always ship `package-lock.json` when dependencies change.** It's the
   source of truth for `npm ci`, which is what most production builds use.
2. **Native deps in transitive dependencies are the silent killer** of
   serverless deploys. Always prefer pure-JS alternatives.
3. **17-second build failures are install-stage failures**, not compile
   failures. Future me: don't chase webpack ghosts when the timer says
   sub-30-seconds.

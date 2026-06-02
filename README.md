# LedgerPro — Hotfix: Railway build failure (pdfkit bundling)

## What broke

The recon-reports bundle added `pdfkit` and `exceljs` as runtime
dependencies. Next.js 14's webpack tried to bundle both for the server,
but `pdfkit` ships built-in fonts as `.afm` files that webpack can't
follow through its module-resolution machinery. This is a well-known
issue with `pdfkit` + Next.js / webpack.

Result: Railway build failed during `npm run build`.

## What this fixes

One file: `next.config.js`. Adds both `pdfkit` and `exceljs` to
`experimental.serverComponentsExternalPackages`:

```js
experimental: {
  serverActions: { allowedOrigins: ['*'] },
  serverComponentsExternalPackages: ['pdfkit', 'exceljs'],
},
```

What this does: Next.js skips webpack bundling for these packages
entirely. At runtime, they're loaded via Node's normal `require()` from
`node_modules`, which is exactly how they're designed to work. The
`.afm` font files and other resources stay intact.

I verified locally that `next build` now compiles successfully past
the webpack stage. (The local sandbox can't continue past "Collecting
page data" because it can't run `prisma generate` for the Prisma client
— that's a sandbox limitation, not relevant to Railway, which DOES run
prisma generate.)

## Deploy

```
cd C:\ledgerpro
# extract the zip — overwrites next.config.js
git add -A
git commit -m "Hotfix: mark pdfkit + exceljs as serverComponentsExternalPackages"
git push
```

Railway will rebuild. The webpack compile step should now complete
successfully. The recon export feature will work after redeploy.

## Why I missed this

Both packages compiled fine in the sandbox's `tsc` type-check, and the
smoke test that generated real .xlsx and .pdf files used `tsx` (which
runs TypeScript via Node directly, bypassing webpack entirely). The
issue is webpack-specific to the Next.js production build, which the
sandbox can't fully replicate due to the Prisma engine binary blocker.

Going forward: when I add Node-only packages with file-system resources
(fonts, certificates, native code, etc.), I'll proactively add them to
`serverComponentsExternalPackages` rather than waiting for a Railway
build to fail.

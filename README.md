# LedgerPro — FX auto-fetch (frankfurter.app)

Adds a "↓ Fetch latest" button to the FX Rates page that pulls live rates
from frankfurter.app (free service backed by the European Central Bank).
Manual rates are never overwritten.

## What's in this zip

- `src/lib/fx/fetch.ts` — Server-side fetcher with the manual-override
  semantics built in (manual rows are detected and skipped during upsert).
- `src/app/api/fx/fetch/route.ts` — POST endpoint. OWNER-only.
- `src/app/page.tsx` — replaces existing. Adds Fetch latest button and
  modal to the FX Rates page.
- `tests/fx-fetch.test.ts` — 5 new tests for fetch parsing + manual-override
  logic.

## Deploy steps

1. Extract zip at root of your `ledgerpro` repo
2. Commit + push:
   ```
   git add -A
   git commit -m "FX auto-fetch from frankfurter.app"
   git push
   ```
3. No new dependencies, no migrations, no env vars.

## How to use it

1. Go to **FX Rates** in the sidebar
2. Click **↓ Fetch latest**
3. In the modal:
   - Pick a **Base currency** (default USD)
   - Pick **Date**: "Latest" (today's ECB publication) or a specific past date
4. Click **Fetch now**
5. The modal shows a summary:
   - How many rates were inserted
   - How many were skipped because manual overrides exist
   - Which requested currencies aren't published by ECB (e.g. AED, KWD)
6. The rate history table refreshes — you'll see new rows with source `frankfurter.app`

## Behavior notes

- **About 30 currencies** are supported by ECB / frankfurter: USD, EUR, GBP,
  CAD, AUD, INR, JPY, CNY, SGD, CHF, HKD, BRL, MXN, KRW, and ~15 others.
- **AED, KWD, SAR, and other GCC currencies** are NOT in the ECB feed.
  You'll have to use manual entry for those.
- **Weekends:** ECB doesn't publish on Saturday or Sunday. If you fetch on a
  weekend (or request a weekend date), frankfurter returns Friday's rate.
  The system uses the returned `effectiveDate`, not the date you asked for.
- **Manual override:** any rate row with `source = 'manual'` is preserved
  during fetch — even if frankfurter would return a different rate for the
  same pair and date. To force-replace with the fetched rate, delete the
  manual row first.
- **No API key:** frankfurter.app is free and unauthenticated. No env-var
  setup needed.

## Tested

109 tests pass total. 5 new tests cover:
- Parsing the frankfurter response shape
- Detecting unsupported requested currencies
- Building upsert candidates
- Skip-manual-override decision logic
- Weekend date handling (response date ≠ requested date)

## Where rates go from here

Once you have rates loaded, they'll automatically be used by:
- The Convert widget on the same FX page (already wired)
- **Pass 2** Inter-company transactions, where mirror entries auto-convert
  to the counterparty's functional currency using the rate effective on the
  transaction date
- **Pass 3** FX revaluation utility (period-end revaluation of monetary
  balances at the period-end rate)

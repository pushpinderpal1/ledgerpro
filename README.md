# LedgerPro — Fixed Asset Register module

Adds a complete fixed-asset register with depreciation calculation and
automatic GL posting. Net book value flows into the Balance Sheet,
depreciation expense flows into the P&L — both happen automatically because
the depreciation engine creates real journal entries.

## Domain model

Three Prisma models (additive — no breaking changes):

- **AssetCategory** — depreciation policy: method (straight-line or
  declining balance), useful life, annual rate, **plus three GL account
  links**: Fixed Asset (cost), Accumulated Depreciation (contra-asset),
  Depreciation Expense.
- **FixedAsset** — individual assets: number, description, acquisition date,
  cost, salvage value, useful life, location, serial number, status
  (`ACTIVE` / `DISPOSED` / `FULLY_DEPRECIATED`).
- **DepreciationEntry** — one row per asset per period, linking to the
  shared journal entry that booked the run. Unique on `(fixedAssetId,
  periodEnd)` for idempotency.

Two new enums: `DepreciationMethod` (STRAIGHT_LINE | DECLINING_BALANCE)
and `AssetStatus`.

## What's in this zip

- `prisma/schema.prisma` — replaces existing. Adds 3 models, 2 enums,
  back-relations on LegalEntity and Account.
- `prisma/migrations/0005_fixed_assets/migration.sql` — additive, safe.
- `src/lib/assets/depreciation.ts` — pure math: monthlyDepreciation,
  projectSchedule, depreciationDueThrough. No DB deps, fully testable.
- `src/lib/assets/index.ts` — DB-backed engine: runDepreciation,
  disposeAsset, getAssetWithAccum. Period-lock-aware, idempotent.
- `src/lib/auth/index.ts` — replaces existing. Adds `assets:read`
  (AUDITOR) and `assets:write` (ACCOUNTANT) permissions.
- `src/app/api/asset-categories/route.ts` — full CRUD with audit logging.
- `src/app/api/fixed-assets/route.ts` — GET/POST + PATCH with three
  actions: `depreciate`, `dispose`, `edit`.
- `src/app/page.tsx` — replaces existing. Adds Fixed Assets sidebar item
  and full UI with two tabs (Register / Categories), asset detail with
  depreciation schedule, disposal modal, and depreciation-run modal.
- `tests/depreciation.test.ts` — 17 unit tests covering straight-line,
  declining-balance, salvage floors, catch-up, and date helpers.

## Deploy steps

1. Extract zip at the root of your `ledgerpro` repo
2. Commit + push:
   ```
   git add -A
   git commit -m "Fixed Asset Register module"
   git push
   ```
3. Railway will apply migration `0005_fixed_assets` automatically.
4. **No new npm dependencies.** No env-var changes.

## How to use it

1. **Set up Chart of Accounts** (if not already): make sure you have a
   `Fixed Assets` asset account (e.g. 1500), an `Accumulated Depreciation`
   asset account that will hold a credit balance (e.g. 1510), and a
   `Depreciation Expense` expense account (e.g. 6200).
2. **Create asset categories** under Fixed Assets → Categories. For each:
   pick the depreciation method, useful life, annual rate, and link the
   three GL accounts.
3. **Register assets** under Fixed Assets → Asset register → Add asset.
   The category's defaults pre-fill but can be overridden per asset.
4. **Run depreciation** monthly by clicking "Run depreciation" → pick the
   period end date → submit. The engine:
   - Calculates one month of depreciation per active asset
   - Caps at salvage value (no over-depreciation)
   - Posts ONE journal entry per run with lines grouped by category:
     `DR Depreciation Expense / CR Accumulated Depreciation`
   - Creates `DepreciationEntry` rows linked to that JE
   - Marks assets as `FULLY_DEPRECIATED` when they hit salvage
   - Idempotent: re-running for the same period skips already-booked assets
   - "Catch-up" checkbox books cumulative dep for legacy assets that have
     never been depreciated
5. **Dispose** an asset by opening it from the register → click "Dispose
   asset" → enter disposal date, proceeds, proceeds account (Bank/AR), and
   gain/loss account. The engine books the full disposal JE:
   `DR Cash + DR Accum Dep / CR Fixed Asset (+ DR Loss or CR Gain)`.

## How it shows up in reports

No changes to the Reports module are needed — the engine just creates
ordinary journal entries, so:

- **Balance Sheet**: Fixed Asset accounts show cost; Accumulated
  Depreciation (an ASSET-type account with a credit balance) appears as a
  negative number under Assets. Net of the two = Net Book Value, exactly
  what an auditor expects.
- **Profit & Loss**: Depreciation Expense appears in the Expenses section
  for whatever period you're reporting on.
- **Journal Report**: every depreciation run is a single `DEPR-YYYY-MM-NNNN`
  reference; every disposal is `DISP-YYYY-NNNN`.

## Tests

17 unit tests pass against the depreciation math:
```
npm test
```

Coverage includes:
- Straight-line + declining-balance correctness
- Salvage floor (never depreciates below salvage)
- Last-month rounding (total never exceeds cost − salvage)
- Schedule projection and book-value monotonicity
- Catch-up depreciation calculation
- Date helpers (end-of-month, inclusive month diff)

The DB-backed engine (runDepreciation, disposeAsset) is not unit-tested in
this pass — integration tests against a test Postgres would be the right
next step.

## Honest caveats

- **Pro-rate convention**: depreciation runs treat the acquisition month
  as a full month. If you need mid-month or daily proration, that's a
  small addition to `monthlyDepreciation`.
- **One depreciation period per run**: the modal asks for one period-end
  date. To depreciate Jan, Feb, Mar in one go you'd run it three times.
  Could add a "depreciate from X through Y" multi-period mode if needed.
- **Disposal requires you to pick a gain/loss account**: future
  enhancement could read it from a global setting.
- **Period locks apply**: if you've locked April 2026, you can't run
  April depreciation until you release the lock.

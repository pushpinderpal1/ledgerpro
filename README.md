# LedgerPro — Corporate Group Structure + FX Rates (Pass 1)

Foundational pass for holding-company / subsidiary support and multi-currency
operations. Schema, library, API, and UI for:

- **Group structure**: parent ↔ child entity relationships with ownership %,
  acquisition date, entity type (Standalone / Holding / Subsidiary / Branch).
- **FX rates**: manual entry with effective dates, history, conversion preview.

This is the prerequisite for the next two passes:
- **Pass 2**: Inter-company transactions with approval workflow
- **Pass 3**: FX revaluation with manual-approval posting

## What's in this zip

- `prisma/schema.prisma` — adds `parentEntityId`, `ownershipPercent`,
  `acquisitionDate`, `entityType` to LegalEntity; adds `FxRate` model;
  adds `EntityType` enum.
- `prisma/migrations/0006_group_structure/migration.sql` — additive, safe.
- `src/lib/fx/rates.ts` — pure FX math: pickRate (with inverse fallback),
  convert (rounded to 2 dp), convertAmount.
- `src/lib/fx/index.ts` — DB-backed helpers: getRateOn, convertOn,
  upsertRate, listAllRates.
- `src/app/api/group/route.ts` — GET tree + PATCH (set-parent / detach /
  update-meta) with cycle detection.
- `src/app/api/fx/route.ts` — GET (list + conversion preview), POST (upsert),
  DELETE. Write access requires OWNER role on at least one entity.
- `src/app/page.tsx` — adds Group Structure and FX Rates sidebar items + pages.
- `tests/fx-rates.test.ts` — 10 unit tests for FX math.

## Deploy steps

1. Extract zip at root of your `ledgerpro` repo
2. Commit + push:
   ```
   git add -A
   git commit -m "Group structure + FX rates (multi-entity Pass 1)"
   git push
   ```
3. Railway applies migration `0006_group_structure` automatically.
4. No new dependencies, no env vars.

## What you'll see

- New **Group Structure** item in sidebar (OWNER / ADMIN only)
- New **FX Rates** item in sidebar (OWNER / ADMIN / ACCOUNTANT)

### Group Structure page

- Shows your entities as a corporate tree (indented hierarchy)
- Each row: name, currency, entity-type badge, ownership %, acquisition date
- Click **Edit** on any node to set a parent, ownership %, acquisition date,
  and entity type
- The parent picker excludes descendants to prevent cycles
- When you parent an entity, the parent auto-promotes to HOLDING if it was
  previously STANDALONE
- Detach by clearing the parent dropdown
- All structure changes are audited (GROUP_PARENT_SET / GROUP_DETACHED /
  GROUP_META_UPDATED)

### FX Rates page

- Filter by from/to currency
- **Convert** widget — preview any conversion as of any date; shows the
  rate used, effective date, and whether it was direct or inverse
- **+ Add rate** form — enter `1 USD = X EUR` style rates with effective
  date, source label (manual / RBI / ECB / etc.), and notes
- Rate history table — every stored rate, deletable by OWNER
- The system uses these rates automatically for inter-company conversions
  in Pass 2

## Foundations established for Pass 2 + 3

- Multi-currency operations now have a rate-lookup mechanism with date-
  effectivity. Pass 2 will use it for IC mirror entries.
- Group relationships are explicit, so Pass 2 can list valid IC counterparties.
- The cycle-detection logic for group hierarchy will be reused for any
  future "consolidation up to X" feature.

## Tests

10 new tests, 104 total, all passing:
```
npm test
```

FX coverage:
- Same-currency identity
- Picks active rate as of date
- Picks most recent eligible rate
- Inverse rate fallback
- Throws for missing rates (both pair-missing and date-too-early)
- 2-decimal rounding
- Inclusive effective-date matching

## Open product decisions confirmed for next passes

| Decision | Choice (your input) |
|---|---|
| Ownership % | "Mostly 100%, support partial as data" — schema supports any % from 0–100 |
| Mirror entry workflow | "Suggest and require approval" — Pass 2 will stage mirror JEs as PENDING_APPROVAL |
| FX rate source | "Manual with override" — auto-fetch deferred; manual is the only path now |
| FX revaluation | "Suggest and approve" — Pass 3 will stage revaluation JEs the same way |

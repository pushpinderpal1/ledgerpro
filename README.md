# LedgerPro — Custom Financial Statement Designer

Lets users build their own financial statement layouts. Each template is an
ordered list of lines (HEADER / ACCOUNT / GROUP / SUBTOTAL / SPACER) that gets
rendered against the entity's posted journal data for any date range.

This completes the three-feature ask from earlier:
  ✓ Drill-down to source transaction       (shipped earlier)
  ✓ Dashboards with KPIs                   (shipped earlier)
  ✓ Custom financial statement designer    (this bundle)

## What's in this zip

- `prisma/schema.prisma` — adds `StatementTemplate` model. Lines stored as
  JSON for flexibility (no schema churn when line types evolve).
- `prisma/migrations/0010_statement_templates/migration.sql` — single
  additive migration. Creates `statement_templates` table.
- `src/lib/statement-templates/runner.ts` — pure runner logic:
  - `naturalBalance(rawSigned, type)` — sign convention helper
  - `runTemplate({ lines, rawByAccount, accountsById })` → `{ rows, grandTotal }`
  - `validateTemplate(lines)` → error array
- `src/lib/statement-templates/index.ts` — DB-backed wrapper. Loads only
  the accounts referenced by the template (not the whole COA) for fast runs.
- `src/app/api/statement-templates/route.ts` — full CRUD plus
  `?id=&run=1&from=&to=` to execute and render.
- `src/app/page.tsx` — replaces existing. Adds sidebar item
  "Custom Statements" with three views: list, builder, runner.
- `tests/statement-runner.test.ts` — 18 unit tests on the runner.

## Line types

| Type     | Description                                         |
|----------|-----------------------------------------------------|
| HEADER   | Section title — no value, bold styling              |
| ACCOUNT  | One account's natural balance for the period        |
| GROUP    | Sum of multiple accounts' natural balances          |
| SUBTOTAL | Sum of all ACCOUNT and GROUP lines since previous SUBTOTAL |
| SPACER   | Blank row for visual separation                     |

## Sign convention

The runner shows **natural balances** by default:
- ASSET / EXPENSE / COGS — debit-positive (raw debit − credit)
- LIABILITY / EQUITY / REVENUE — credit-positive (raw credit − debit)

This is what an accountant expects: revenue shows positive when there's
revenue; expenses show positive when there's spend. The `invert` checkbox
on a line flips the sign for special cases (e.g., showing contra-revenue
as a negative deduction).

## How to use it

### Sidebar → Custom Statements → + New template

1. Give the template a name (e.g. "Management P&L", "Operating Margins by Cost Center")
2. Add lines using the +Header / +Account / +Group / +Subtotal / +Spacer buttons
3. For ACCOUNT lines: pick one account from the dropdown
4. For GROUP lines: click "Pick accounts" → check boxes for any number of accounts
5. SUBTOTAL automatically sums every ACCOUNT and GROUP line since the previous SUBTOTAL
6. Reorder with ▲ / ▼ buttons next to each line
7. Save

### Run a template

1. Click "Run" next to any template
2. Pick a date range (presets: today, this/last month, this/last quarter, YTD, this/last year, custom)
3. Output renders with proper formatting:
   - Headers in bold with underline
   - Account rows indented
   - Subtotals with top border + bold + light background
   - Grand total at the very end with double border
4. Export as CSV or Print

### Permissions

- View: anyone with `journals:read` (OWNER, ADMIN, ACCOUNTANT, AUDITOR)
- Create / Edit / Delete: ACCOUNTANT or higher
- Run: anyone who can view

## Example template — "Operating Margins"

```
HEADER    Income
ACCOUNT   Service Revenue     → account 4000
ACCOUNT   Product Revenue     → account 4100
SUBTOTAL  Total revenue                        15,000

SPACER

HEADER    Direct costs
ACCOUNT   COGS                → account 6000
ACCOUNT   Materials           → account 6100
SUBTOTAL  Total direct costs                    3,500

SPACER

HEADER    Operating expenses
GROUP     Personnel costs     → accounts 5100, 5200, 5300
GROUP     Facility costs      → accounts 5500, 5600
SUBTOTAL  Total opex                            4,000

GRAND TOTAL                                     7,500
```

## Deploy

```
cd C:\ledgerpro
# extract the zip, overwriting existing files
git add -A
git commit -m "Custom financial statement designer"
git push
```

Railway runs migration `0010_statement_templates`. No new deps, no env vars.

## After deploy — verify

1. Sidebar → **Custom Statements** appears
2. **+ New template** → name it, add a header + 1-2 account lines + a subtotal → Save
3. Back on list view, click **Run** → output renders with your data
4. **Export CSV** → file downloads
5. Try editing the template, reordering lines with ▲/▼, adding a GROUP line

## What's NOT in this bundle (intentional)

- **Conditional/calculated rows** — e.g. "% of revenue" columns. Currently
  one column of values per template.
- **Comparison columns** — current period vs prior period vs budget side-by-side.
  This is doable as a future enhancement.
- **Drill-down from template rows** — the runner returns `accountIds` per row
  so drill-down can be wired in later, but UI isn't built yet.
- **Drag-and-drop reorder** — uses ▲/▼ buttons instead. Drag-drop needs a
  library; arrows work fine for the typical 10-30 line template.
- **Template sharing across entities** — each template is entity-scoped.
  Copying between entities is a future "Clone to entity" feature.
- **Versioning / approval** — templates are mutable. Edits affect future runs.
  For change tracking, the AuditLog records create/update/delete actions.

## Tests

166 total tests passing:
- 18 new in `statement-runner.test.ts` covering:
  - `naturalBalance` sign conventions per type
  - Simple P&L with multiple sections and subtotals
  - GROUP summing multiple accounts
  - `invert` flag
  - SUBTOTAL counter resetting between sections
  - HEADER/SPACER null values
  - Missing accounts handled silently (return 0)
  - Drill-down accountIds preserved per row
  - Lines without subtotal still added to grand total
  - validateTemplate catches: empty lines, missing accountId, empty accountIds, duplicate ids
  - validateTemplate passes valid templates and handles SPACER without label

## Notes

The runner is deliberately decoupled from the database. Given balances and
account metadata, it produces rendered rows. This makes the math trivially
testable and reusable for future cases — e.g. running templates against
budget data instead of actuals would just swap the input map.

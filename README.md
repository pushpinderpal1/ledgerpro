# LedgerPro Audit Trail module

Adds a comprehensive audit trail: centralized logging helper with redaction
of sensitive fields, a query API with filters and pagination, and a
QuickBooks-style UI page accessible to OWNER / ADMIN / AUDITOR.

## What's in this zip

- `src/lib/audit/index.ts` — new helper. Use `logAudit({ entityId, userId,
  action, resource, resourceId, before, after, request })` from any
  state-changing operation. Auto-redacts passwords, secrets, ACH numbers, etc.
- `src/app/api/audit/route.ts` — new GET endpoint. Filters by date range,
  action, resource, user; paginated; returns aggregate facets so the UI can
  populate filter dropdowns.
- `src/app/api/periods/route.ts` — replaces existing. Now logs PERIOD_LOCKED
  and PERIOD_RELEASED events (previously unaudited).
- `src/lib/auth/index.ts` — replaces existing. Adds `audit:read` permission
  (AUDITOR-level).
- `src/app/page.tsx` — replaces existing. Adds the **Audit Trail** sidebar
  item and full page with filter bar, paginated table, before/after diff
  expansion, and CSV export.
- `tests/audit-sanitize.test.ts` — 9 new tests for the sanitizer logic.

## Deploy steps

1. Extract zip at the root of your `ledgerpro` repo
2. Commit + push:
   ```
   git add -A
   git commit -m "Add audit trail module"
   git push
   ```
3. No new env vars, no database migrations, no new dependencies.

## What you'll see

- New **Audit Trail** item in the sidebar (visible to OWNER, ADMIN, AUDITOR)
- Page shows a filter bar (date range, action dropdown, resource dropdown,
  search by resource ID) and a paginated table of every audited event
- Each row: timestamp, user (name + email), action badge (color-coded by
  verb — green for create/post, red for void/delete, blue for update),
  resource type, resource ID, IP address
- Click "Show" on any row → expands a before/after JSON diff
- "Export CSV" downloads the current filtered set
- 50 entries per page, with pagination controls

## What's audited today (no changes needed)

- Journal entries — create, post, void
- Payments — cheque issued, ACH issued, payment voided
- Reconciliations — completed
- Users — entity access grants, role changes, deactivations
- Entities — created
- **Period locks** — locked, released (new in this pass)

## What's still not audited (gaps to close in a future pass)

- Account changes (create, edit, deactivate)
- AP invoice operations (create, edit, mark paid)
- 2FA events (these are user-level, not entity-level — the AuditLog model
  requires entityId so user-scoped events don't fit cleanly; would need a
  separate UserAuditLog table or a schema change to make entityId optional)
- Reconciliation start (only completion is logged today)

To close these, replace the direct `db.auditLog.create(...)` calls in
existing routes with the new `logAudit(...)` helper — it auto-redacts and
adds IP capture.

## Sanitization

The helper automatically redacts any field whose name contains (case-
insensitively): `password`, `secret`, `token`, `apiKey`, `totpSecret`,
`jwt`, `sessionToken`, `achAccountNo`, `routingNo`, `codeHash`,
`backupCode`. So you can safely pass full record objects as `before`/`after`
without worrying about leaking credentials into the audit log.

Tested: 9 unit tests cover redaction, nested redaction, depth limit, length
cap, Date/BigInt serialization, and case-insensitive matching. Run with
`npm test`.

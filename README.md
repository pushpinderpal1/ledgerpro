# Vendor Master + Approval Workflow

Adds a full vendor master to the AP module with QuickBooks-style detail capture,
contract/document upload, service catalog with frequency, and a maker-checker
approval workflow. Approved vendors automatically appear in the AP invoice
booking dropdown.

---

## What's in this bundle

### Schema (`prisma/schema.prisma`)

Two new models + two new enums:

- **`Vendor`** — identity, contact, address, tax, financial, bank details, and
  workflow status. Includes a `defaultAccountId` FK so AP can preset the expense
  GL when booking invoices.
- **`VendorService`** — service catalog tied to a vendor: name, frequency,
  optional default GL account, estimated amount.
- **`enum VendorStatus`** — `PENDING_APPROVAL | APPROVED | REJECTED | INACTIVE`
- **`enum VendorFrequency`** — `ON_DEMAND | DAILY | WEEKLY | MONTHLY | QUARTERLY | SEMI_ANNUAL | ANNUAL | STATUTORY | ONE_TIME | OTHER`

Modifications to existing models:

- **`ApInvoice`** — adds nullable `vendorId` FK (legacy free-text `vendor` field stays for back-compat).
- **`Attachment`** — adds nullable `vendorId` FK so contracts and other documents can be hung off a vendor (the existing many-to-many to `ApRequest` is untouched).
- **`Account`** — adds back-relations `vendorsAsDefault` and `vendorServicesAsDefault`.
- **`LegalEntity`** — adds back-relation `vendors`.

### Migration (`prisma/migrations/0013_vendor_master/migration.sql`)

92 lines. Creates the two enums, two tables (`vendors`, `vendor_services`), two
`ALTER TABLE`s (adds `vendorId` to `ap_invoices` and `attachments`), and five FK
constraints. Idempotent against the rest of your schema.

Railway will run this automatically on the next deploy.

### State machine (`src/lib/vendor/state.ts`)

Pure logic, no DB. Used by `/api/vendors` for the workflow transitions:

```
[new]            → PENDING_APPROVAL   (submit on create)
PENDING          → APPROVED           (action: 'approve')
PENDING          → REJECTED           (action: 'reject', reason required)
REJECTED         → PENDING_APPROVAL   (action: 'resubmit')
APPROVED         → INACTIVE           (action: 'archive')
INACTIVE         → APPROVED           (action: 'reactivate')
```

Same-user-cannot-approve-own is enforced via `canActUpon` — only blocks
`approve` and `reject`, not the other actions (so an AP_CLERK can still
resubmit a vendor they themselves submitted and got rejected).

Reject without a non-empty `reason` is rejected with `code: 'reason_required'`.

### Tests (`tests/vendor-workflow.test.ts`)

14 tests covering: every valid transition, every invalid transition, reason
validation (incl. whitespace-only), self-approve block on both approve/reject,
self-resubmit allowed, frequency display mapping.

Run with `npm test` — combined with prior suites you should see **200 passing**.

### Permissions (`src/lib/auth/index.ts`)

Three new keys, role-hierarchy based:

- `vendors:read`    → AUDITOR+ (CLIENT_VIEW is below this)
- `vendors:write`   → AP_CLERK+ (create vendors, add/edit/remove services, upload documents)
- `vendors:approve` → ACCOUNTANT+ (approve / reject / archive / reactivate)

### APIs

**`/api/vendors`** (`src/app/api/vendors/route.ts`)

- `GET    ?entityId=&status=&q=` — list with optional status + free-text search; includes status-count summary for tab badges.
- `GET    ?entityId=&id=`         — full detail (services + attachments metadata + invoice count).
- `POST   { entityId, ...fields }` — create. Status auto-set to `PENDING_APPROVAL`. Auto-numbers `V-NNNN` if `vendorNumber` blank. Validates `defaultAccountId` belongs to the entity.
- `POST   { entityId, id, transition, reason? }` — workflow action. Detected by the `transition` key in the body.
- `PATCH  { entityId, id, ...fields }` — edit. Blocked on INACTIVE vendors (reactivate first). PENDING/REJECTED/APPROVED all editable; changes are audit-logged.
- `DELETE ?entityId=&id=` — archives (sets INACTIVE) when invoices reference it; otherwise hard-deletes. Requires `vendors:approve`.

**`/api/vendor-services`** (`src/app/api/vendor-services/route.ts`)

Standard CRUD scoped to vendor + entity. Validates `defaultAccountId` belongs to the entity. `PATCH` supports toggling `isActive` for soft-disable.

**`/api/attachments`** (`src/app/api/attachments/route.ts`) — extended

- `POST` now accepts optional `vendorId`. If present, permission check switches from `ap-request:submit` → `vendors:write` and the attachment is linked to the vendor (cascade-delete on vendor delete).
- `GET` and `DELETE` peek at `attachment.vendorId` to pick the right read/write permission. Attachments without a `vendorId` continue to use the AP request permissions as before. No breaking change for existing AP attachments.

**`/api/ap`** (`src/app/api/ap/route.ts`) — extended

- `POST` now accepts optional `vendorId`. If provided, the route checks that the vendor (a) belongs to the entity and (b) is **APPROVED**. Anything else is rejected with 409. The legacy `vendor` free-text field still works for one-off vendors not in the master.

### UI (`src/app/page.tsx`)

A new sidebar entry — **🏢 Vendor Master** under the Payables group, above
"AP Tracker". Mounts a new page with three modes:

1. **List view** — KPI tiles for each status, filter tabs (`All` / `Pending Approval` / `Approved` / `Rejected` / `Inactive`) with badge counts, free-text search across name/number/tax-ID/email, and a sortable table. Click any row to open the detail view.
2. **Create form** — five sections (Identity, Address, Tax & Compliance, Financial, Bank Details), with a "Submit for Approval" CTA. A yellow banner reminds the user that the vendor will go through approval before being usable.
3. **Detail view** — header with vendor name + status badge + role-aware action buttons (Approve / Reject / Edit / Resubmit / Archive / Reactivate), and three tabs:
   - **Details** — read-only grid of all captured fields.
   - **Services** — add / edit / remove / toggle-active. Frequency dropdown shows all 10 enum values. Each service can have its own default GL account and estimated amount.
   - **Documents** — file picker (max 5 MB) for uploading contracts, NDAs, SOWs, etc. Each document gets a Download and a Delete button (Delete requires `vendors:write`).

**AP invoice form integration** — when a user opens "+ Add invoice" in the AP
Tracker, the form now shows an "Approved Vendors" dropdown at the top. Picking
a vendor auto-fills the free-text vendor name (still editable for one-off
overrides). A yellow info banner appears if no approved vendors exist yet,
pointing the user to Vendor Master.

---

## Roles in practice

| Role         | Can browse vendors | Can create / edit | Can approve / reject |
| ------------ | ------------------ | ----------------- | -------------------- |
| OWNER        | ✓                  | ✓                 | ✓                    |
| ADMIN        | ✓                  | ✓                 | ✓                    |
| ACCOUNTANT   | ✓                  | ✓                 | ✓ (but not own)      |
| AP_CLERK     | ✓                  | ✓                 | —                    |
| AUDITOR      | ✓ (read-only)      | —                 | —                    |
| CLIENT_VIEW  | —                  | —                 | —                    |

The maker-checker invariant — "same user can't approve a vendor they
submitted" — is enforced at the API layer using the `canActUpon` helper. The
DB stores `submittedBy` on every submit / resubmit, so the check works even
across long gaps.

---

## Deploy

```bat
cd C:\ledgerpro
git add .
git commit -m "Vendor Master with approval workflow"
git push origin main
```

Railway will:

1. Run `prisma migrate deploy` → applies `0013_vendor_master`.
2. Build Next.js.
3. Restart the server.

After deploy, hard-refresh in the browser (Ctrl+Shift+R) to pick up the new
sidebar entry and component.

---

## Quick walkthrough

1. **Sign in as an AP_CLERK** (or higher). Open **Payables → Vendor Master**.
2. Click **+ New Vendor**. Fill in at least the legal name. Hit **Submit for Approval**.
3. The vendor now shows up in the **Pending Approval** tab with status `PENDING_APPROVAL`.
4. **Sign in as an ACCOUNTANT** (must be a different user — same-user-can't-approve-own is enforced).
5. Open Vendor Master, click the pending vendor, review the details, then click **Approve**.
6. Switch tabs to **Approved**. Open the vendor, go to the **Services** tab, click **+ Add Service**, fill in (e.g.) "Monthly bookkeeping" with frequency **Monthly**, optional estimated amount, and a default GL account. Save.
7. Go to the **Documents** tab, upload the contract PDF.
8. Open **Payables → AP Tracker**, click **+ Add invoice**. The newly approved vendor is in the dropdown — pick it, and the vendor name auto-fills.

---

## Scope cuts (consider for v2)

- **No email notifications.** Approvers find pending vendors by visiting the Pending tab. Easy to add via the existing audit log + Sentry hooks later.
- **No edit-as-new-version for APPROVED vendors.** Today APPROVED vendors can be edited directly with an audit log entry — no re-approval cycle. SAP-style "all edits require re-approval" is a future hardening pass.
- **Bank info stored as plaintext.** Account numbers, routing, IBAN, etc. are not encrypted at rest. They're access-controlled via `vendors:read`, but for compliance-sensitive deployments wrap with AES-256-GCM the same way 2FA secrets are (`ENCRYPTION_KEY` env var is already set up).
- **No vendor portal.** Vendors can't self-serve onboarding — everything goes through internal users. This is intentional for a finance-grade workflow.
- **Document versioning.** Uploading a new contract doesn't supersede an old one — both stay in the list. Add a tag/category system if multi-version contract tracking is needed.
- **No dedicated "Vendor Approvals" view.** The Pending Approval tab inside Vendor Master is the queue. A separate top-level "Approvals" inbox aggregating vendors + expense requests is a natural Phase 2.

---

## Files touched

| File                                                | Change   |
| --------------------------------------------------- | -------- |
| `prisma/schema.prisma`                              | modified |
| `prisma/migrations/0013_vendor_master/migration.sql`| new      |
| `src/lib/vendor/state.ts`                           | new      |
| `src/lib/auth/index.ts`                             | modified |
| `src/app/api/vendors/route.ts`                      | new      |
| `src/app/api/vendor-services/route.ts`              | new      |
| `src/app/api/attachments/route.ts`                  | modified |
| `src/app/api/ap/route.ts`                           | modified |
| `src/app/page.tsx`                                  | modified |
| `tests/vendor-workflow.test.ts`                     | new      |

No new npm dependencies — uses what's already in the project (Zod, Prisma,
React, etc.).

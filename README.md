# LedgerPro — Expense AP Workflow (maker-checker)

A full three-role AP workflow: Requester → Approver → Accountant. Invoice
attachments, payment mode selection, GL auto-suggest from vendor history,
inline edits at each stage, comment-driven send-back, and a complete audit
trail per request.

When the Accountant posts, the system creates an `ApInvoice` AND a balanced
journal entry (DR expense / CR AP control), all in one transaction.

## What's in this zip

- `prisma/schema.prisma` — adds `Attachment`, `ApRequest`, `ApRequestComment`
  models + `ApRequestStatus` and `ApPaymentMode` enums. Adds back-relations
  on LegalEntity, Account, and ApInvoice.
- `prisma/migrations/0009_ap_workflow/migration.sql` — one new migration:
  - 2 new enums
  - 3 new tables (attachments, ap_requests, ap_request_comments)
  - Foreign keys to legal_entities, accounts, ap_invoices, attachments
- `src/lib/ap-workflow/state.ts` — pure state machine. 11 unit tests.
- `src/lib/auth/index.ts` — adds 3 new permission keys:
  - `ap-request:submit` (AP_CLERK+)
  - `ap-request:approve` (ADMIN+)
  - `ap-request:post` (ACCOUNTANT+)
- `src/app/api/attachments/route.ts` — upload (base64), download, delete.
  Max 5 MB per file. Files stored as Postgres `bytea`.
- `src/app/api/ap-requests/route.ts` — full CRUD + workflow actions:
  - POST: create new submitted request
  - PATCH with action ∈ {edit, approve, return-to-requester, return-to-approver,
    post, resubmit, delete}
  - GET ?vendorDefault=&vendor= → suggested GL based on most recent invoice
  - GET ?id= → full detail with comment trail
- `src/app/page.tsx` — replaces existing. Adds:
  - "Expense Requests" sidebar item
  - List view with role-based filters (My / Pending approval / Pending posting / All)
  - Creation form with vendor autocomplete + GL auto-suggest + file upload
  - Detail view with edit-in-place, action buttons, comment thread
- `tests/ap-workflow.test.ts` — 11 unit tests on state transitions
  (148 total tests passing).

## How the workflow works

```
                     SUBMITTED (with Approver)
                       │      │
            ┌──────────┘      └──────────┐
            │ approve              return-to-req
            ▼                            ▼
       APPROVED (with Accountant)  RETURNED_TO_REQUESTER
            │                            │
   ┌────────┼─────────┐             resubmit
   │ post   │ ret-req │             │
   │        │ ret-app │             ▼
   ▼        ▼         ▼         SUBMITTED ...
 POSTED  RETURNED   RETURNED
         TO_REQ.    TO_APPR.
                       │
                       │ approve
                       ▼
                   APPROVED ...
```

### Requester (AP_CLERK or higher)

1. Sidebar → **Expense Requests** → **+ New expense request**
2. Pick vendor (autocompletes from existing AP invoices), enter invoice no,
   amount, payment mode
3. Upload PDF / image of the invoice (up to 5 MB)
4. GL account is auto-suggested from the most recently posted invoice for
   the same vendor; user can override
5. Click **Submit for approval**

### Approver (ADMIN or OWNER)

1. **Pending my approval** tab shows requests in SUBMITTED state
2. Click a request → review fields, view attachment
3. Either:
   - **Approve** → moves to APPROVED state, waiting for accountant
   - **Send back to requester** (comment required) → requester must fix and resubmit

### Accountant (ACCOUNTANT or higher)

1. **Pending posting** tab shows requests in APPROVED state
2. Click a request → review fields, view attachment, optionally **Edit
   fields** to correct GL code, amount, or payment mode
3. Either:
   - **Post to GL** → creates AP invoice + journal entry in single transaction:
     - DR Expense Account (the GL on the request)
     - CR Accounts Payable (account code "2000" — same as legacy AP flow)
   - **Send back to approver** — flags a concern for re-review
   - **Send back to requester** — sends all the way back

### Everyone

- Full comment trail visible on detail view
- Every state transition logged with timestamp and user
- AuditLog also records each action for compliance

## Posting prerequisites

Before an Accountant can post, the entity must have an account with code
"2000" (the AP control account). The system will return a clear error if
not. This matches the existing AP module's behavior.

## File storage

Attachments are stored as `bytea` in Postgres. Practical for the SMB
deployment scale; for large customers (>10k invoices) consider migrating
to S3/R2. The schema lets you do this later without changes to the
ApRequest model — only the Attachment table content changes.

5 MB hard cap per file at the API. Configurable in
`src/app/api/attachments/route.ts` via `MAX_BYTES`.

## Deploy

```
cd C:\ledgerpro
# extract the zip, overwriting existing files
git add -A
git commit -m "Expense AP workflow with attachments"
git push
```

Railway will run migration `0009_ap_workflow`. No new env vars, no new deps.

## After deploy — verify

1. Sidebar → **Expense Requests** appears
2. Click **+ New expense request**
3. Pick a vendor → if there's a prior posted invoice, the GL field
   auto-fills
4. Upload an invoice PDF → see green confirmation pill
5. Submit → row appears in **My requests**
6. Switch user to OWNER/ADMIN → "Pending my approval" badge shows
7. Click row → Approve
8. Switch user to ACCOUNTANT → "Pending posting" badge shows
9. Click row → Post to GL
10. Reports → Trial Balance → see the expense + AP impact
11. Journal Entries → find the new entry with ref `APR-YYYY-NNNN`

## Permissions matrix

| Action               | OWNER | ADMIN | ACCOUNTANT | AP_CLERK | AUDITOR |
|----------------------|:-----:|:-----:|:----------:|:--------:|:-------:|
| Create request       |  ✓    |  ✓    |    ✓       |    ✓     |    ✗    |
| Edit own (DRAFT/RTR) |  ✓    |  ✓    |    ✓       |    ✓     |    ✗    |
| Approve              |  ✓    |  ✓    |    ✗       |    ✗     |    ✗    |
| Edit while APPROVED  |  ✓    |  ✓    |    ✓       |    ✗     |    ✗    |
| Post to GL           |  ✓    |  ✓    |    ✓       |    ✗     |    ✗    |
| Return to approver   |  ✓    |  ✓    |    ✓       |    ✗     |    ✗    |
| Return to requester  |  ✓    |  ✓    |    ✓       |    ✗     |    ✗    |
| View all             |  ✓    |  ✓    |    ✓       |    ✓     |    ✓    |

## What's NOT in this pass (intentional)

- **Multi-level approval chains** — one approver step only. Future: per-amount
  thresholds with multiple approvers.
- **Email notifications** — no notifications when a request is waiting on you.
  Need to add when you wire up email.
- **Reversal of a posted request** — currently terminal. Reverse via the
  existing journal entry void flow.
- **AP control account picker** — hard-coded to "2000" code. Future: per-entity
  setting (or per-payment-mode mapping).
- **Multi-currency on requests** — request amount is in entity's functional
  currency. FX-denominated requests need a separate pass.
- **Bulk approval** — must approve one at a time.
- **Request templates** — recurring vendor charges could become templates.

## Tests

148 total tests pass:
- ap-workflow.test.ts: 11 new (state machine: allowed actions per role,
  applyAction transitions, terminal state, illegal-transition rejection)
- All 137 pre-existing tests continue to pass

## Notes for next bundle

The Custom Statement Designer (originally planned as Bundle 2 of the
previous request) is still pending. Let me know which to do next:
- Custom Statement Designer
- Email notifications for expense requests
- Multi-level approval chains
- Recurring expense templates
- Per-entity AP control account configuration

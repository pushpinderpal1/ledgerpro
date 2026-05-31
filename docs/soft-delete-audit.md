# Soft-Delete Pattern Audit — LedgerPro

**Date:** 2026-05-31
**Scope:** All `onDelete` behaviors across the Prisma schema and any hard-delete
calls in API routes / library code.
**Goal:** identify where cascade-deletion could destroy financial history, and
recommend soft-delete / void patterns where appropriate.

---

## TL;DR

**Status: Mostly safe, two real risks, several "fine-as-is" items.**

| Risk level | Count | Examples |
|------------|-------|----------|
| 🔴 High — could lose financial history | 2 | LegalEntity cascade, JournalEntry → JournalLine cascade |
| 🟡 Medium — affects auditability but recoverable | 3 | AuditLog tied to entity, ApPayment cascade, IdempotencyKey cascade |
| 🟢 Low / Correct — safe as designed | 8 | Session, BackupCode, BudgetLine, etc. |

**Bottom line:** The most consequential cascade is `LegalEntity → everything`.
Deleting a legal entity today wipes its entire bookkeeping history. This is the
one thing I'd fix before any external pilot.

---

## Methodology

For each `@relation` with a non-default `onDelete` rule, I asked three
questions:

1. **Is the child data financial truth?** (journal entries, payments, recon
   history, audit logs)
2. **Would a regulator, auditor, or angry customer ever want this data back?**
3. **Does the parent get deleted in any user-facing flow today, or only in
   admin/development?**

If 1 + 2 are both yes, that's a soft-delete candidate regardless of 3.

---

## Findings by model

### 🔴 HIGH RISK

#### 1. `LegalEntity` cascade-deletes the entire entity world

```prisma
// In ~14 child models:
entity LegalEntity @relation(..., onDelete: Cascade)
```

**Children that get wiped if a `LegalEntity` is deleted:**
Account, JournalEntry, ApInvoice, Employee, PayrollRun, Budget, Client,
IifImport, Payment, BankReconciliation, LockedPeriod, IdempotencyKey, AuditLog,
EntityAccess.

**Why it's risky.** A single misclick or unauthorized API call to
`DELETE /api/entities/:id` would erase years of bookkeeping. Even if no UI
currently exposes entity deletion, the database is one ad-hoc query away from
catastrophe. For accounting software, "we kept your books but lost them" is the
worst possible failure mode.

**Recommendation: soft-delete.** Add to `LegalEntity`:
```prisma
deletedAt   DateTime?
deletedBy   String?
```
- All API queries filter `where: { deletedAt: null }` by default.
- A new `DELETE /api/entities/:id` route sets `deletedAt = now()` instead of
  actually deleting.
- A separate, OWNER-only "permanent delete" route (with a long confirmation
  flow, e.g. typing the entity name + a 7-day cooling-off period) is what would
  actually `db.legalEntity.delete()`.
- Cascade rules stay as-is — they're the safety net for *intentional* hard
  deletes after the cooling-off period.

**Migration cost:** medium. Need a helper that wraps every entity-scoped query
to add the `deletedAt: null` filter, OR a Prisma extension that does it
globally. About a day's work to do cleanly.

---

#### 2. `JournalEntry` cascade-deletes its `JournalLine` rows

```prisma
model JournalLine {
  entry   JournalEntry @relation(..., onDelete: Cascade)
}
```

**Why it's risky.** The `JournalEntry` schema *already* supports a `VOID`
status, and your void pattern (reversing entries) is exactly the right
approach. But the schema doesn't prevent someone from actually `db.journalEntry.delete()`-ing a posted entry. If they do, the lines go with it — and the trial
balance silently changes, with no audit trail.

**Recommendation:** there are two complementary fixes.

**Fix A (5 minutes):** Add a database-level guard in the migration:
```sql
CREATE OR REPLACE FUNCTION prevent_posted_journal_delete()
RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'POSTED' THEN
    RAISE EXCEPTION 'Cannot delete a POSTED journal entry. Void it instead.';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER journal_entries_block_posted_delete
BEFORE DELETE ON journal_entries
FOR EACH ROW EXECUTE FUNCTION prevent_posted_journal_delete();
```

**Fix B (broader):** Add `deletedAt` to `JournalEntry`, never call
`.delete()` on posted entries from app code, and let DRAFT entries hard-delete
freely (they're not "books"). The void mechanism stays for posted reversals.

Recommend doing both — the trigger is belt-and-suspenders and catches direct
DB access too.

---

### 🟡 MEDIUM RISK

#### 3. `AuditLog` cascades when its `LegalEntity` is deleted

Tied to fix #1. Once that's resolved, the audit log goes too if you ever do a
permanent delete — which is correct *if* you've done the cooling-off properly,
because you want the option to delete an entity's PII for GDPR/DPDP "right to
erasure" requests. But: consider exporting the audit log to S3 / cold storage
before final delete, for any potential later regulatory inquiry.

#### 4. `ApPayment` cascade-deletes with its `ApInvoice`

```prisma
model ApPayment {
  invoice ApInvoice @relation(..., onDelete: Cascade)
}
```

Same problem at smaller scale: a deleted invoice loses its payment history.
The void pattern for invoices should be the rule, not delete. Recommendation:
add `deletedAt` to `ApInvoice` and route deletes through it; never expose
hard-delete in the UI.

#### 5. `IdempotencyKey` cascades on entity delete

Cosmetic — keys are 24-hour-lived anyway, but it does mean retried requests
during entity deletion could behave unexpectedly. Acceptable. No action.

---

### 🟢 LOW RISK / CORRECT AS DESIGNED

| Model | Behavior | Verdict |
|---|---|---|
| `Session` → `User` | Cascade | ✓ Correct — sessions are ephemeral |
| `BackupCode` → `User` | Cascade | ✓ Correct — only useful while the user exists |
| `EntityAccess` → `User/Entity` | Cascade | ✓ Correct — junction table |
| `BudgetLine` → `Budget` | Cascade | ✓ Correct — budget is a draft tool, not "books" |
| `StatementLine` → `BankReconciliation` | Cascade | ✓ Correct — parsed input data |
| `W2Record` → `Employee` | Cascade | ⚠ Borderline — see below |
| `Account` → `JournalLine` | **Restrict** | ✓ Excellent — prevents deleting accounts with history |
| `Account` (self, parent) | SetNull | ✓ Correct — orphans children without data loss |
| `BankReconciliation` → `JournalLine.reconciledId` | SetNull | ✓ Correct — releases lines on recon delete |

**W2Record note:** W-2s are tax filings, retained 4+ years by US law. If you
ever expose employee deletion, route it through a soft-delete OR keep W2Records
separately. As long as `Employee.delete()` is never called from app code
(currently it isn't), you're fine.

---

## Hard-delete calls in code

These are the only places code calls `.delete()` or `.deleteMany()`. None
operate on posted financial data:

| Location | What it deletes | Verdict |
|---|---|---|
| `src/lib/auth/index.ts:84` | A logout-cookie (not a row) | ✓ |
| `src/lib/security/backup-codes.ts:40` | A user's existing backup codes when regenerating | ✓ Intentional and correct |
| `src/app/api/budget/route.ts:119` | Budget lines on budget update (replace-all) | ✓ Acceptable; budgets are drafts |
| `src/lib/security/rate-limit.ts` | In-memory rate-limit buckets | ✓ Not data |

**Good news:** no code path today calls `.delete()` on `JournalEntry`,
`Payment`, `ApInvoice`, `BankReconciliation`, or `LegalEntity`. The current
risk is theoretical — there is no UI button for "delete entity" — but the
schema permits it, which is one DB query or one careless future PR away from a
real loss.

---

## Recommended action plan

If you do nothing else, do **#1** (LegalEntity soft-delete). It's the only
finding that crosses the bar of "could destroy real financial history with one
mistake."

### Sequenced plan

**Phase 1 — Defensive triggers (2-4 hours)**

Add database triggers as a hard floor against accidental data loss. These run
even if app code is buggy or a developer runs an ad-hoc query.

- Block DELETE on `POSTED` journal entries (SQL above)
- Block DELETE on `Payment` rows in status `ISSUED` or `CLEARED`
- Block DELETE on `BankReconciliation` rows with status `COMPLETED`

These three triggers, deployed in a single migration, eliminate ~90% of the
catastrophic-deletion risk without touching app code.

**Phase 2 — LegalEntity soft-delete (1 day)**

- Add `deletedAt` + `deletedBy` columns
- Build a Prisma client extension that auto-filters `deletedAt: null` on all
  queries to `legalEntity` and all relations (Prisma client extensions are
  designed for this)
- Add `DELETE /api/entities/:id` → soft-delete only
- Add `POST /api/entities/:id/permanent-delete` → OWNER + entity-name
  confirmation + 7-day timer

**Phase 3 — Soft-delete for invoices and employees (half-day each)**

Lower priority, do these when you build the matching UI flows.

---

## What I'd skip

- **Soft-deleting journal entries.** Voiding with a reversing entry is the
  correct accounting pattern. Adding `deletedAt` on top would be belt-and-
  suspenders that complicates trial balance queries with no clear win.
- **Soft-deleting users.** Standard practice is to deactivate (`isActive = false`)
  rather than soft-delete. Users tie to audit logs (`userId String?`) which
  already supports SetNull behavior.
- **Soft-deleting accounts.** `onDelete: Restrict` on `JournalLine.account` is
  already protecting you: you literally cannot delete an account that has
  history. That's better than soft-delete in this case.

---

## Open question for product

If a customer wants to "delete my entire workspace" for GDPR/DPDP "right to
erasure" reasons, what happens to:

- **Their JournalEntries** — which contain transaction amounts, vendor names,
  payment instructions. Probably need to be deleted.
- **Their AuditLog** — which records "who did what when," including the
  customer themselves. Conflicting interests: GDPR wants delete; financial
  regulations may want preserve.
- **Their backups** — RDS PITR snapshots may persist data for the retention
  window (14 days in our CDK config). Most GDPR DPIAs accept this as long as
  there's no operational access to the snapshots.

You'll want a documented policy and possibly a legal review before going live
in EU/UK/India. Not a code change, but worth flagging now.

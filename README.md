# LedgerPro update — hardening + 2FA pass

Extract this zip at the **root of your `ledgerpro` repo** (the folder that
contains `package.json` and `prisma/`). Existing files will be overwritten;
new files will be created in the right folders.

## What's in here

- `prisma/schema.prisma` — schema with hardening + 2FA models (replaces existing)
- `prisma/migrations/0003_hardening/migration.sql` — period locks + idempotency keys
- `prisma/migrations/0004_two_factor/migration.sql` — TOTP + backup codes
- `src/middleware.ts` — security headers + CSRF origin check (replaces existing)
- `src/lib/auth/index.ts` — adds 2FA challenge-token helpers (replaces existing)
- `src/lib/security/*` — rate-limit, headers, password, idempotency, encryption, TOTP, backup codes
- `src/lib/periods/index.ts` — period locking enforcement
- `src/lib/logger.ts`, `src/lib/errors.ts` — structured logging + Sentry-ready hook
- `src/lib/payments/index.ts`, `src/lib/recon/{index,parse}.ts` — period-guarded + extracted parser
- `src/app/api/auth/login/route.ts`, `register/route.ts` — rate-limited, password complexity, 2FA-aware
- `src/app/api/auth/2fa/{setup,verify,challenge,manage}/route.ts` — 2FA endpoints
- `src/app/api/payments/route.ts` — idempotency-key support
- `src/app/api/periods/route.ts` — lock/release period endpoints
- `src/app/api/health/route.ts` — `/api/health` and `/api/health?deep=1`
- `package.json` — adds `tsx` devDep + `test` script (replaces existing)
- `tests/*` — 68 tests, pure-logic, run with `npm test`
- `infra/*` — AWS CDK stack (not used by Railway; ignore for now)

## Before you push

### 1. Set ENCRYPTION_KEY in Railway

Generate a 32-byte key:
```
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
In Railway → Variables, add `ENCRYPTION_KEY` = the 64-char hex string.

This is used to encrypt TOTP secrets at rest. Without it the app falls back to
deriving a key from `JWT_SECRET` and logs a warning — works but rotating
`JWT_SECRET` would brick stored 2FA secrets.

### 2. (Optional) Set TRUSTED_ORIGINS

If you have additional origins that need to make cross-origin calls (e.g. a
separate admin domain), set `TRUSTED_ORIGINS` as a comma-separated list.
Otherwise the middleware only allows the current host.

## After you push

Railway will:
1. Run `npm install` (picks up `tsx`)
2. Run `prisma generate` (postinstall)
3. Run `prisma migrate deploy` — applies both 0003 and 0004
4. Build Next.js and start

Watch for `All migrations have been successfully applied.` then `Ready in …ms`.

## Running tests locally

```
npm install
npm test
```

Should report `68 pass`. No database needed for any of them.

## Notes

- **No UI changes in this pass.** 2FA endpoints work via API only; UI to enable
  2FA from the app comes in the next pass.
- **infra/** is for a future AWS migration. It doesn't affect Railway. Safe to
  keep in the repo; safe to delete if you want.

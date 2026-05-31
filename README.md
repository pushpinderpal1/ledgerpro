# LedgerPro UI update — 2FA settings + Period locks

Extract at the root of your `ledgerpro` repo (the folder containing
`package.json` and `prisma/`). Two files:

- `src/app/page.tsx` — replaces existing. Adds:
  - 2FA panel in Settings (enable / verify / show backup codes / disable / regenerate)
  - Login screen 2FA challenge step (asks for a code after password when 2FA is on)
  - New **Period Locks** page (lock/release months for OWNER/ADMIN)
- `docs/soft-delete-audit.md` — written audit, no code changes. Recommends
  defensive triggers + a soft-delete on `LegalEntity` if you take it forward.

## Deploy steps

1. Extract over the repo (overwrite `page.tsx`, add the new doc)
2. Commit and push:
   ```
   git add -A
   git commit -m "2FA settings UI + Period Locks UI + soft-delete audit"
   git push
   ```
3. Watch Railway logs — no migrations, just a Next.js rebuild.

## What you should see after deploy

- Settings page now has a "Two-factor authentication" card below entity settings
- New "Period Locks" item in the sidebar (only visible to OWNER/ADMIN)
- Logging in as a 2FA-enabled user prompts for the 6-digit code

No new environment variables. No new dependencies. No database changes.

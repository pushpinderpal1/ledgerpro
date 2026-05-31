# LedgerPro QR-code update for 2FA setup

Adds a "Scan QR code" button to the 2FA setup flow that opens a popup with a
scannable QR rendered locally in the browser (no third-party services — the
secret never leaves your app).

## What's in this zip

- `src/app/page.tsx` — replaces existing. Adds the QR modal to TwoFactorPanel.
- `package.json` — replaces existing. Adds `qrcode` runtime dep and `@types/qrcode`.

## ⚠ Important: update the lock file before pushing

Because `package.json` changed, `package-lock.json` must be regenerated or
Railway's `npm ci` will fail (same as last time).

In `C:\ledgerpro`, after extracting this zip:

```
npm install
```

Wait for it to finish (15-30 seconds). It updates `package-lock.json`.

Then commit and push:

```
git add -A
git commit -m "Add QR code modal to 2FA setup"
git push
```

## What you should see after deploy

1. Go to **Settings** → click **Enable 2FA**
2. The setup card now has a big "📱 Scan QR code" button at the top
3. Click it — a popup appears with the QR code
4. Open Google Authenticator on your phone → tap **+** → tap **Scan a QR code**
5. Point your phone's camera at the QR on screen — it scans and adds the account
6. Close the popup, enter the 6-digit code your authenticator shows
7. You're 2FA-enabled

The "Open on this device" link still works (taps open the authenticator app on
mobile), and there's still a collapsible "Can't scan? Show secret to enter
manually" section as fallback.

## How it works under the hood

The QR is generated locally using the `qrcode` library, lazy-loaded on first
button click so it doesn't bloat the main bundle. The otpauth:// URI never
touches any external server. The QR renders as inline SVG, sharp at any zoom.

# LedgerPro — Hotfix: sidebar groups crash

## What was broken

The sidebar-groups bundle introduced a Rules of Hooks violation. I placed
the `useState` call for the `collapsedGroups` state **after** an early
`if (!user) return ...` short-circuit, which means:

- On the first render (no user yet), React encountered 5 hooks
- On the second render (after user loads), React encountered 6 hooks
- React throws "Rendered more hooks than during the previous render"
- The error surfaces in the browser as the generic "Application error:
  a client-side exception has occurred" message

This is a classic React mistake — hooks must always be called in the same
order, every render. Conditional `return` statements before a hook are
forbidden.

## What this fixes

One file: `src/app/page.tsx`. The `useState` and `toggleGroup` are moved
to the top of the component, before any conditional return. No other
changes — the grouped sidebar structure and behavior are identical to
what I shipped previously.

## Deploy

```
cd C:\ledgerpro
git add -A && git commit -m "Hotfix: move sidebar useState above conditional return" && git push
```

After Railway redeploys, hard-refresh. The grouped sidebar should now
load correctly. You'll see Dashboard at top, followed by 8 collapsible
groups (Books, Payables, Reconciliations, Reports, Assets & Payroll,
Planning & MIS, Setup, Admin).

## Tests

All 166 tests continue to pass.

## On me

I should have caught this when I added the `useState`. The Rules of
Hooks are unforgiving and the failure mode is unhelpful at the surface
(generic "Application error"). Going forward I'll verify hook order
when adding state to components with early returns.

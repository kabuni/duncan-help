# Fix: "View submissions" button missing on Scout / Newsletter cards

The button + dialog + edge function action (`form_submissions`) are already implemented in:
- `src/components/ceo/CommsPulseCard.tsx` (`FormSubmissionsButton`, rendered at line 286)
- `supabase/functions/hubspot-api/index.ts` (`form_submissions` action + `fetchFormSubmissionsList`)

So the button is wired up, but it isn't showing for you. There are three realistic causes — I'll address all of them in one pass.

## Likely causes

1. **Rendered only when `fm.found === true`.** Today the button sits inside the `fm?.found` branch (line 286). If HubSpot returns "form not found" for newsletter/scout in the persisted briefing payload, the card shows "Form not found in connected portal" and no button — even for a CEO/admin.
2. **Role check.** `canView = isCEO(user?.email) || isAdmin`. `isCEO` only matches `nimesh@kabuni.com` / `palash@kabuni.com`. If you're signed in with a different email and don't have the `admin` row in `user_roles`, the button is correctly hidden — but you may expect to see it.
3. **Role query still loading.** `useIsAdmin()` returns `isAdmin = false` while the query is in flight, so on first paint `canView` can be false and the button is skipped until the query resolves and the component re-renders. With the current code this self-heals, but it can look "missing".

## Changes

### 1. `src/components/ceo/CommsPulseCard.tsx`
- Lift `FormSubmissionsButton` so it renders **regardless of `fm.found`** (next to the metric block, not inside it). When the form isn't found, the button is still shown to CEO/admin and the dialog will simply display "No submissions found" / the underlying API error — which is the diagnostic signal we actually want.
- Keep the role gate exactly as-is (`isCEO(user?.email) || isAdmin`) so non-privileged users still see nothing.
- Small a11y/clarity tweak: button label stays "View submissions", with `aria-label` including the form name.

### 2. Quick verification step (no code change)
After the edit I'll:
- Confirm your account either matches `CEO_EMAILS` or has an `admin` row in `user_roles` (via a read query). If neither is true, the button is intentionally hidden and we'll need to either add you to `user_roles` as admin or extend `CEO_EMAILS` — I'll surface that explicitly rather than silently widening access.
- Hit `hubspot-api` with `{ action: "form_submissions", form_key: "newsletter" }` to confirm the backend path still returns rows end-to-end.

## Out of scope
- No changes to the totals / last-30d numbers visible to everyone.
- No change to the edge function's auth gate (still CEO emails + `admin` role server-side).
- No CSV export, no caching.

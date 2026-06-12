# Plan: View submissions on Newsletter / Scout cards

Add an admin/CEO-only "View submissions" button to the two form cards in the Team Briefing's `CommsPulseCard`. The existing totals stay visible to everyone; only authorised roles can drill into the per-person list (name, email, location, submitted date).

## 1. Backend — new `form_submissions` action in `hubspot-api`

In `supabase/functions/hubspot-api/index.ts`:

- Add a handler branch `action === "form_submissions"` (next to `team_briefing_summary`).
- Input: `{ form_key: "newsletter" | "scout", limit?: number (default 100, max 500) }`. Optional `form_id` override.
- **Authorisation (server-side, not just UI):**
  - Require an authenticated user (existing `getUser(req)` path).
  - Allow only if the caller is in `CEO_EMAILS` **or** has the `admin` role in `public.user_roles`. Otherwise return 403.
- Resolve the HubSpot token via existing `resolveTeamBriefingToken`.
- Reuse `pickForm` against `/marketing/v3/forms?limit=100&formTypes=all` with the same matchers already used by `buildHubspotFormMetrics` (`newsletter / subscribe / signup / sign up`, and `scout`).
- Page through `/marketing/v3/forms/{formId}/submissions` (fallback to `/form-integrations/v1/submissions/forms/{formId}` on 404/410, mirroring `fetchHubspotForms`) until `limit` is reached or no more pages.
- For each submission extract: `submittedAt`, contact id (`contact.vid` / `contactId`), and the `email`, `firstname`, `lastname` values from `sub.values`.
- Batch-read contacts via existing `fetchContactsLocations` plus `firstname`/`lastname` properties to enrich `city`, `country`, and display name where missing.
- Return `{ form_name, form_id, submissions: [{ name, email, city, country, submitted_at }], truncated: boolean }`.

No DB schema changes; no new tables; no new secrets.

## 2. Frontend — gated button + submissions dialog

In `src/components/ceo/CommsPulseCard.tsx`:

- Import `useAuth`, `useIsAdmin`, and `isCEO` from `@/lib/ceoAccess`.
- Compute `canViewSubmissions = isCEO(user?.email) || isAdmin`.
- For each of the two form cards (lines ~264–286), when `fm?.found && canViewSubmissions`, render a small `Button` ("View submissions") under the totals. Button is **not rendered at all** for other users.
- On click, open a `Dialog` (using existing `@/components/ui/dialog`) that:
  - Calls `supabase.functions.invoke("hubspot-api", { body: { action: "form_submissions", form_key: "newsletter" | "scout" } })`.
  - Shows loading state, error state, and a `Table` with columns **Name · Email · Location · Submitted**.
  - Location renders `city, country` (falls back to `—`); date formatted via existing `formatRelativeOrDate` helper or `Intl.DateTimeFormat`.
  - If `truncated`, show a small footer note ("Showing first N submissions").

## Files touched

- `supabase/functions/hubspot-api/index.ts` — new action handler + small helper for submission listing/enrichment.
- `src/components/ceo/CommsPulseCard.tsx` — role check, button per card, submissions dialog component (inline or co-located).

## Out of scope

- No change to the existing totals / last-30d numbers or the location-breakdown table — those remain visible to all viewers.
- No CSV export (can be added later if requested).
- No caching layer; each open fetches fresh from HubSpot.

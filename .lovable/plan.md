## Problem

On `/team-briefing`, the HubSpot card's "Marketing forms" section renders each form's name (e.g. `#scout-signup .scout-modal_form-wrap`) but the submission count slot stays empty (no number, no "submissions" label).

Inspecting the latest snapshot in `ceo_briefings.payload.hubspot_signal.lists` confirms it: every entry has `member_count: null` and no `error` field. The frontend (`CommsPulseCard.tsx` ~L440) only renders the count block when `typeof list.member_count === "number"`, so a `null` collapses the row to just the form name — matching what the user sees.

The count is produced by `fetchHubspotForms` in `supabase/functions/hubspot-api/index.ts` (L480–569), which calls `/form-integrations/v1/submissions/forms/{formId}` and paginates `paging.next.after`. Today's payload shows the call effectively returned no `total` and no `results` (count stayed 0, but ended up stored as `null` — meaning the count path is either silently bailing or being clobbered downstream in `ceo-briefing` normalization).

## Plan

### 1. Instrument and reproduce
- Add focused logs inside `fetchHubspotForms`: for each form log `{ formId, name, pages, totalFromApi, count, status, sampleKeys }` and log the raw first-page response keys when `totalFromApi` is null and `results` is empty. Also log the final `submission_count` per form before push.
- Deploy `hubspot-api` and trigger a fresh fetch (via `ceo-briefing` re-run or by curling the `hubspot-api` action used by Team Briefing).
- Read the logs to confirm which case we are in:
  a. HubSpot returns 401/403 (scope) — caught path, `error` should be present (so normalization is stripping it).
  b. HubSpot returns `{ results: [], paging: null }` — count stays 0; then somewhere `0` is being turned into `null`.
  c. Endpoint path/version is wrong for this portal.

### 2. Fix the count source
Based on what the logs show, apply one of:

- **If the v1 endpoint is unauthorized for this portal/token** (most likely cause given silent null): switch to the supported endpoint
  `/marketing/v3/forms/{formId}/submissions?limit=50` and paginate via `paging.next.after`. Keep the v1 path as a fallback for older portals.
- **If the response is empty but valid**: store `0` (not `null`) so the UI shows `0 submissions` instead of hiding the row, and surface that explicitly.
- **If we got an error**: ensure the `error` field propagates all the way through `ceo-briefing`'s `lists` passthrough (currently at `supabase/functions/ceo-briefing/index.ts` ~L3781) so the UI's amber "Lookup failed" branch renders instead of a blank count.

### 3. Frontend safety net
In `CommsPulseCard.tsx` (~L440), render `member_count ?? 0` with the "submissions" label whenever the form was matched and there is no error, so a future null never silently hides the metric again. Keep the existing error branch for the failure case.

### 4. Verify
- Re-trigger a briefing snapshot, query `ceo_briefings.payload->'hubspot_signal'->'lists'` and confirm each form has a numeric `member_count` (or a populated `error`).
- Reload `/team-briefing` and confirm every Marketing form row shows `<count> submissions`.

## Files touched

- `supabase/functions/hubspot-api/index.ts` — logging + submission-count endpoint fix, ensure `0` vs `null` semantics
- `supabase/functions/ceo-briefing/index.ts` — only if `lists` passthrough is dropping the `error`/`member_count` fields
- `src/components/ceo/CommsPulseCard.tsx` — render `member_count ?? 0` for matched forms without errors

## Out of scope

- The newsletter/scout `form_metrics` tiles at the top of the HubSpot block (those already display totals).
- Any change to which forms are fetched or how they are filtered.

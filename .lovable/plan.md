# Fix: Marketing Lists shows 0 on CEO Briefing

## Root cause (confirmed from code + DB)

`hubspot-api` (action `team_briefing_summary`) successfully fetches forms via `/marketing/v3/forms` and `/form-integrations/v1/submissions/...`, and includes them in its response under the `lists` field (`buildTeamBriefingSummary`, `supabase/functions/hubspot-api/index.ts` line 810).

However, when `ceo-briefing` consumes that response, it builds `parsed.payload.hubspot_signal` by **explicitly enumerating fields** at `supabase/functions/ceo-briefing/index.ts` lines 3749–3771 — and `lists` is **not in that allow-list**, so it gets dropped before the briefing row is written to `ceo_briefings.payload`.

Verification from the latest stored briefing row (DB query just now): the persisted `hubspot_signal` JSON has no `lists` key at all, even though every other field (key_contacts, active_deals, etc.) is present.

The UI in `src/components/ceo/CommsPulseCard.tsx` (lines 314–322) reads `hubspotSignal.lists`, finds `undefined`, falls back to `[]`, and renders the "0" badge with the empty-state message. The frontend code is correct.

It is also possible that `normalizeExternalSignal` (which produces `normalizedHubspotSignal`) strips `lists` even before the projection at line 3749. The fix needs to ensure both layers preserve it.

## Change

Single-file backend fix in `supabase/functions/ceo-briefing/index.ts`:

1. Add `lists: normalizedHubspotSignal.lists ?? hubspot_signal?.lists ?? []` to the `parsed.payload.hubspot_signal = { ... }` object at line 3749.
2. Inspect `normalizeExternalSignal` (used at line 1338) and, if it doesn't already pass through unknown fields, ensure the raw `lists` array from the upstream `hubspot-api` response is forwarded onto the normalized signal (or read directly from `hubspot_signal.lists` in the projection as a fallback — option already covered by step 1's `?? hubspot_signal?.lists`).

No frontend changes. No DB migration. No changes to `hubspot-api`.

## Verification

1. Trigger a fresh briefing generation from the UI.
2. Run `SELECT payload->'hubspot_signal'->'lists' FROM ceo_briefings ORDER BY briefing_date DESC LIMIT 1;` — should return the array of forms with `requested_name`, `member_count`, `processing_type`.
3. Reload Team Briefing — Marketing forms section should show `N/N` badge and per-form submission counts instead of `0`.

## Out of scope

- HubSpot connection / vault wiring (already fixed in prior turn).
- Renaming "Marketing forms" vs "Marketing Lists" copy.
- Changes to which forms are fetched (currently up to 100 forms via `/marketing/v3/forms?limit=100`).

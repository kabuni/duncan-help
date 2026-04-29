## Goal

Add a fourth column to the HubSpot section on Team Briefing showing membership counts for two named lists: **Scout Programme** and **Marketing Newsletter**. Wire up `hubspot-api` to fetch them and `CommsPulseCard.tsx` to render them.

## Important caveat (from prior diagnosis)

The currently connected HubSpot portal (`147532149`) does **not contain** lists named "Scout Programme" or "Marketing Newsletter" — only 3 unrelated workflow/spam lists. After this change, the column will render with the correct UI but show **0 / not found** until the integration is reconnected to the production portal that holds those lists.

The implementation handles this gracefully: if a list isn't found by name, the UI shows "Not found in portal" with a helpful tone, instead of an error.

## Changes

### 1. `supabase/functions/hubspot-api/index.ts`

Inside the `team_briefing_summary` action (around line 762-774), after the existing companies/deals/contacts fetch, add a parallel fetch for HubSpot Lists:

- Use `POST /crm/v3/lists/search` with body `{ query: "Scout Programme", count: 5 }` and same for `"Marketing Newsletter"` (already verified scope `crm.lists.read` works on this token).
- For each match, resolve to the best name match (case-insensitive exact > contains).
- Fetch member count via `GET /crm/v3/lists/{listId}` (response includes `additionalProperties.hs_list_size` or membership metadata).
- Add a new helper `fetchHubspotLists(token, source)` that returns:
  ```ts
  Array<{
    requested_name: string;       // "Scout Programme" | "Marketing Newsletter"
    list_id: string | null;
    matched_name: string | null;  // actual name in HubSpot, null if not found
    member_count: number | null;  // null if not found
    processing_type: string | null; // "MANUAL" | "DYNAMIC"
    updated_at: string | null;
  }>
  ```
- Wrap the lists fetch in its own try/catch so a list failure does NOT degrade the whole HubSpot section. On failure, return entries with `member_count: null` and a `error` field.
- Extend `HubspotSummary` type and `buildTeamBriefingSummary()` to accept and pass through a `lists` field.

### 2. `src/components/ceo/CommsPulseCard.tsx`

- Extend the `hubspotSignal` prop type (around line 50-93) with:
  ```ts
  lists?: Array<{
    requested_name: string;
    list_id: string | null;
    matched_name: string | null;
    member_count: number | null;
    processing_type: string | null;
    updated_at: string | null;
    error?: string | null;
  }>;
  ```
- Change the HubSpot grid (line 215) from `xl:grid-cols-3` to `xl:grid-cols-4` and add a fourth column "Marketing lists":
  - Header badge shows count of lists found (e.g. `2/2` or `0/2`).
  - Each list rendered as a row with: name, member count (large tabular-num), and a small badge for `processing_type` ("Static" / "Dynamic").
  - If `matched_name` is null: show "Not found in portal" in muted tone.
  - If `error` is present: show "Lookup failed" in amber tone with the error.
- Reuse the existing `hubspotEmptyTone` pattern for empty states.

### 3. No DB / config changes required

- `crm.lists.read` scope already verified on the live token.
- No new secrets, no new tables, no migrations.

## Technical details

```text
Team Briefing HubSpot row (after change):

┌──────────────┬──────────────┬──────────────┬────────────────────┐
│ Active deals │ At-risk accts│ Key contacts │ Marketing lists    │
│              │              │              │ ──────────────────│
│  ...         │  ...         │  ...         │ Scout Programme   │
│              │              │              │   142 · Dynamic   │
│              │              │              │ Marketing News.   │
│              │              │              │   Not found       │
└──────────────┴──────────────┴──────────────┴────────────────────┘
```

API endpoints used:
- `POST https://api.hubapi.com/crm/v3/lists/search` — find list by name
- `GET https://api.hubapi.com/crm/v3/lists/{listId}` — fetch list metadata + size

Both go through the existing `hubspotApi()` helper (Bearer token, same error classification).

## Out of scope

- Reconnecting HubSpot to the correct portal (user action, already flagged).
- Listing actual list members or contacts in those lists (only counts).
- Configurable list names in UI (hardcoded as requested).

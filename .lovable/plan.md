## Goal

Replace the hardcoded HubSpot **Lists** lookup ("Scout Programme", "Marketing Newsletter") in `hubspot-api/index.ts` with a fetch of **all HubSpot Forms** via `GET /marketing/v3/forms`, return name + submission count for each, and surface them in the existing "Marketing lists" card on the CEO Briefing.

## Why

The two names being searched are HubSpot **Forms**, not Lists. The `/crm/v3/lists/search` endpoint will never match them, which is why the section shows nothing. Switching to the Forms API and showing all forms will (a) actually display real data and (b) let us see what's available before deciding what to highlight.

## Changes

### 1. `supabase/functions/hubspot-api/index.ts`

- **Remove** the `TEAM_BRIEFING_LISTS` constant (line 47).
- **Replace** `fetchHubspotLists()` (lines 475–~570) with `fetchHubspotForms(token, source)`:
  - Call `GET /marketing/v3/forms?limit=100` via the existing `hubspotApi()` helper.
  - For each form, also fetch its submission count from `GET /form-integrations/v1/submissions/forms/{formId}?limit=1` (HubSpot returns `total` in the response). Run these in parallel with `Promise.all`, capped to a reasonable concurrency (e.g. 10 at a time) to stay under rate limits. If submission lookup fails for a form, return `submission_count: null` rather than failing the whole batch.
  - Return an array shaped to stay backwards-compatible with the existing `CommsPulseCard` UI (which reads `requested_name`, `matched_name`, `member_count`):
    ```ts
    {
      requested_name: form.name,        // shown as the label
      matched_name: form.name,          // non-null = "found" styling
      list_id: form.id ?? form.guid,
      member_count: submissionCount,    // reused as "submissions"
      processing_type: form.formType ?? null,
      updated_at: form.updatedAt ?? null,
    }
    ```
  - Keep `logHubspot(...)` calls for observability (rename event labels from `list_*` → `form_*`).
- **Update** the call site at line 898 (`fetchHubspotLists` → `fetchHubspotForms`) and the variable name in the `Promise.all`.
- Leave `buildTeamBriefingSummary` and the `lists` field on the response untouched — the UI will continue to read `signal.lists` and we'll just be feeding forms into it. (No frontend rename needed in this pass to keep the diff small; we can rename `lists` → `forms` end-to-end as a follow-up.)

### 2. `src/components/ceo/CommsPulseCard.tsx` (label only)

- Change the section heading "Marketing lists" → **"Marketing forms"** (line ~321).
- Change the per-row count label so users understand the number is submissions, e.g. show `member_count` as "{n} submissions" instead of relying on the implicit "members" reading. (Inspect lines 315–360 and adjust the small caption above the number; the value rendering itself stays the same.)

No type changes, no other consumer updates.

## Out of scope

- Renaming the response field from `lists` to `forms` across the edge function + UI types — keeping the existing field name avoids a wider refactor. Flagged as a follow-up.
- The Forms API requires the `forms` scope on the HubSpot Private App token. If it's missing the call will return 403; the function will log it and return an empty array (existing error path). I'll mention this in the verification step so you can grant the scope if needed.

## Verification after applying

1. Open CEO Briefing → "Marketing forms" section should list every form in HubSpot with its submission count.
2. Check `supabase--edge_function_logs` for `hubspot-api` → look for `form_fetch_ok` with a non-zero count, no 403s.
3. If 403: add the `forms` scope to the HubSpot Private App and retry.

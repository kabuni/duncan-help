## Plan: HubSpot card — Newsletter / Scout form metrics + location breakdown

Add compact metric tiles at the top of the HubSpot sub-card showing total + last-30d submission counts for the Newsletter signup form and the Scout form, plus a location breakdown table grouped by contact city/country. Existing sections (Active deals, At-risk, Key contacts, Marketing forms list) stay unchanged.

### Backend — `supabase/functions/hubspot-api/index.ts`

1. **Identify the two forms by name** (case-insensitive substring match against `form.name` from existing `/marketing/v3/forms?limit=100` fetch):
   - Newsletter: match any of `newsletter`, `subscribe`, `signup` (first hit wins, prefer `newsletter`).
   - Scout: match `scout`.
   - If no match, return zero counts with a `not_found` flag so the UI can show "Form not found".

2. **New helper `fetchFormMetrics(token, source, formId)`**: paginates `/form-integrations/v1/submissions/forms/{formId}?limit=50` (HubSpot caps at 50) using the `paging.next.after` cursor. For each submission, capture `submittedAt` (ms) and the associated `contact.vid` / contact email from the submission's `values` array (email field). Stop paginating when oldest submission is older than 30 days **AND** we've collected the full total — but since `total` is returned on first page, use that for the "total" metric and only paginate enough pages to cover last 30d for the time window count.
   - Returns: `{ form_id, form_name, total, last_30d_count, contact_emails_30d: string[], contact_vids_30d: string[] }`.

3. **Resolve location for 30d submitters** via batch read `/crm/v3/objects/contacts/batch/read` with `properties: ["city","country","email"]` and `inputs` from the union of vids/emails for both forms. Build a `Map<contactId, {city, country}>`.

4. **Aggregate location breakdown**: produce `location_breakdown: Array<{ location: string, newsletter_count: number, scout_count: number }>` where `location = [city, country].filter(Boolean).join(", ") || "Unknown"`. Sort by total desc, cap at 10 rows.

5. **Extend `HubspotSummary` and `buildTeamBriefingSummary`** with new field:
   ```ts
   form_metrics?: {
     newsletter: { form_name: string|null, total: number, last_30d: number, found: boolean };
     scout: { form_name: string|null, total: number, last_30d: number, found: boolean };
     location_breakdown: Array<{ location: string; newsletter_count: number; scout_count: number }>;
   }
   ```

6. **Wire into team_briefing handler** (line ~874): after `fetchHubspotForms`, identify the two target forms from the existing `lists` result, call `fetchFormMetrics` for each in parallel, then resolve contacts and aggregate. Wrap in try/catch — on failure, omit `form_metrics` and log; do not break the rest of the card.

### Frontend — `src/components/ceo/CommsPulseCard.tsx`

1. **Extend `hubspotSignal` Props type** with the `form_metrics` shape above.

2. **Render new "Form metrics" block** at the very top of the HubSpot section (inside the existing `{hubspotSignal ? (...)` container, before the 4-column grid). Two parts:

   **a. Compact tiles row** — 2 tiles, side by side:
   ```
   [ Newsletter signups          ] [ Scout submissions          ]
   [ 1,247 total · 38 last 30d   ] [ 562 total · 14 last 30d    ]
   ```
   Use existing `rounded border bg-background/60 p-2.5` styling. If `found: false`, show "Form not found in connected portal" muted text.

   **b. Location breakdown table** — below the tiles, only if `location_breakdown.length > 0`. Compact 3-col table using existing `<Table>` primitives (`text-xs`, explicit borders matching project style):
   ```
   Location          | Newsletter | Scout
   London, UK        |    412     |  187
   New York, US      |    298     |  121
   Unknown           |     54     |   23
   ```

3. **Keep all existing sections unchanged** (Active deals, At-risk accounts, Key contacts, Marketing forms grid, status meta).

### Out of scope
- No DB migrations or schema changes
- No changes to non-HubSpot sub-cards (Email/Slack/Azure Repos)
- No historical trend lines, no per-form breakdown beyond Newsletter + Scout
- Form name matching is fixed in code; no admin UI to configure

### Files changed
- `supabase/functions/hubspot-api/index.ts` — new helpers, type extension, wired into team briefing path
- `src/components/ceo/CommsPulseCard.tsx` — type extension + new tiles + location table at top of HubSpot section

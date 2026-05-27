# Fix HubSpot data on Team Briefing

## What's actually wrong

I called `hubspot-api` with `action: team_briefing_summary` and inspected the response. HubSpot **is connected** (token valid, verification call passes), but the card shows mostly empty data:

| Section | Value | Why |
|---|---|---|
| Newsletter / Scout form metrics | `found: false`, 0 submissions | **Code bug** — see below |
| Active deals | 0 | HubSpot CRM truly has 0 deals (confirmed via search) |
| At-risk accounts | 0 | HubSpot CRM truly has 0 companies (confirmed via search) |
| Key contacts | 6 rows showing | Working correctly |

So only one thing on the page is genuinely broken in code: **the marketing form metrics**. The "0 deals / 0 companies" numbers are accurate — there is nothing in the HubSpot CRM yet, and that's a data/setup question, not something the Team Briefing page can fix.

## Root cause for empty form metrics

`supabase/functions/hubspot-api/index.ts` fetches forms from `/marketing/v3/forms?limit=100` (lines 493 and 707). By default this endpoint returns **only native HubSpot-built forms** (`formType: "hubspot"`) and silently drops the other types — `captured` (Webflow / custom HTML / landing-page captures), `flow`, `blog_comment`, and legacy v2 forms.

In this account the only `hubspot`-type form is the placeholder `"New blank form (March 27, 2026 …)"`. The real Newsletter and Scout forms exist but are non-native types, so they never enter the list that `pickForm()` searches, and Newsletter / Scout are reported as `found: false`.

## Fix

Update both call sites to ask HubSpot for all form types:

```
/marketing/v3/forms?limit=100&formTypes=hubspot,captured,flow,blog_comment
```

Files / locations:
- `supabase/functions/hubspot-api/index.ts` line 493 — `fetchHubspotForms`
- `supabase/functions/hubspot-api/index.ts` line 707 — `buildHubspotFormMetrics`

No schema changes, no UI changes, no new env vars. Same response shape, just a wider set of forms feeding the matcher.

## What you'll see after the fix

- If a form with "newsletter" / "subscribe" / "signup" in its name exists (any form type), Newsletter card populates with total + last-30-day count + location breakdown.
- Same for any form whose name contains "scout".
- If no matching name exists in HubSpot, the card will still show `not found`, and the fix in that case is to **rename the form in HubSpot** so the matcher can pick it up (e.g. "Scout Registration", "Newsletter Signup").
- The Active Deals / At-risk Accounts sections will keep showing 0 until real companies and deals are added in HubSpot — that's data, not code.

## Out of scope (deliberately)

- Not touching auth, RLS, or stored-token logic — token resolution works.
- Not changing the CEO/Team Briefing UI (`CommsPulseCard`) — its empty states are already correct for this data.
- Not creating fallback "guess" matchers across HubSpot lists — keeping the existing name-based matcher.

## Verification after build

1. Redeploy `hubspot-api`.
2. `curl` the function with `{ action: "team_briefing_summary" }` and confirm `form_metrics.newsletter.found` / `form_metrics.scout.found` reflect what exists in HubSpot.
3. Open `/ceo-briefing` (Team Briefing) and confirm the HubSpot card shows form numbers when the names match, or a clear "not found" otherwise.


Goal: fix the HubSpot 401 and preserve the unified HubSpot card in Team Briefing without changing any other Team Briefing behavior.

1. Isolate the fix to the HubSpot path only
- Keep Email, Slack, GitHub, scoring, briefing generation, and all non-HubSpot Team Briefing sections unchanged.
- Touch only the HubSpot edge function path, the HubSpot payload pass-through in Team Briefing backend, and the existing HubSpot rendering inside `src/components/ceo/CommsPulseCard.tsx`.

2. Harden `team_briefing_summary` auth in `supabase/functions/hubspot-api/index.ts`
- Preserve existing auth for `status` and `briefing_summary`.
- Keep the narrow internal-call bypass only for `action === "team_briefing_summary"` when invoked by the Team Briefing backend with the service-role header.
- Do not alter the standard end-user JWT flow for all other HubSpot actions.

3. Fix the token resolution path for `team_briefing_summary` only
- Keep Team Briefing on the direct HubSpot API route, not the connector-gateway route.
- In `team_briefing_summary`, resolve credentials in this exact order:
  1. stored token from `company_integrations`
  2. fallback backend secret `HUBSPOT_API_KEY`
- Keep existing connector behavior untouched for other actions.

4. Add explicit diagnostics so the failure mode is visible
- Log whether the `company_integrations` row exists for `integration_id = 'hubspot'`.
- Log whether `encrypted_api_key` is null, empty, or present.
- Log encoded token length and a safe prefix only.
- Decode with `atob()` and log whether decode succeeded.
- Trim the decoded token and log the first 10 characters plus final length only.
- Log which credential source was selected: `stored_token` or `env_secret`.
- Log the outbound auth mode as `Bearer` plus safe token length/prefix only.

5. Guarantee outbound HubSpot auth formatting
- Normalize the selected token once with trim/sanitize logic.
- Reject empty strings after trim.
- Ensure all Team Briefing HubSpot requests use exactly:
  - `Authorization: Bearer <decoded_token>`
- Return a degraded response with explicit error metadata if no usable token exists instead of failing in a way that breaks the rest of Team Briefing.

6. Preserve the one-card UI
- Keep the existing unified HubSpot section in `src/components/ceo/CommsPulseCard.tsx`.
- Do not add a second HubSpot card or a new wrapper component.
- Keep the current top summary intact:
  - Accounts
  - Stale / Risk
  - source / last sync / reason
  - narrative summary
- Keep the CRM detail blocks inline underneath:
  - Active deals
  - At-risk accounts
  - Key contacts

7. Fix the payload pass-through so UI gets the new fields
- In `supabase/functions/ceo-briefing/index.ts`, keep the Team Briefing call to `action: "team_briefing_summary"`.
- Preserve the existing normalization logic.
- Extend the final `parsed.payload.hubspot_signal` assignment so it includes:
  - `active_deals_count`
  - `active_deals`
  - `at_risk_accounts_count`
  - `at_risk_accounts_details`
  - `key_contacts`
- This is required so the existing unified HubSpot card can actually render the CRM details returned by the edge function.

8. Keep the Integrations save path stable, only tighten token hygiene
- Do not redesign the Integrations page flow.
- Keep saving via `manage-company-integration`.
- Retain trimming before verify/upsert.
- No `company_id` change is needed because the current `company_integrations` design is keyed by `integration_id`, not `company_id`.

9. Validation after implementation
- Confirm Team Briefing still loads when HubSpot is disconnected, degraded, or sparse.
- Confirm only one HubSpot card is shown.
- Confirm that one card contains both:
  - existing summary metrics
  - active deals / at-risk accounts / key contacts
- Confirm `team_briefing_summary` no longer returns 401 when a stored token exists.
- Confirm `status` and existing `briefing_summary` behavior remain unchanged.

Technical details
- Files to update:
  - `supabase/functions/hubspot-api/index.ts`
  - `supabase/functions/ceo-briefing/index.ts`
  - `src/components/ceo/CommsPulseCard.tsx` only if any defensive rendering tweak is needed
- No database migration required.
- No auth model change for the rest of Team Briefing.
- No change to non-HubSpot Team Briefing functionality.

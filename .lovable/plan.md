
Goal: keep HubSpot in one unified Team Briefing card and fix the `team_briefing_summary` 401 without touching CEO Briefing’s existing HubSpot summary path.

1. Unify the UI into the existing HubSpot card
- Remove the extra `HubspotDetailSection` render from `src/components/ceo/CommsPulseCard.tsx`.
- Keep the existing `ExternalSignalColumn` for HubSpot as the single card.
- Extend that existing HubSpot card to render three additional detail blocks underneath its current metrics:
  - Active deals
  - At-risk accounts
  - Key contacts
- Keep the current top summary exactly as-is:
  - Accounts
  - Stale / Risk
  - existing source / last sync / summary text
- Add the CRM detail lists inline inside the same HubSpot card, not as a sibling card and not as a new component.

2. Diagnose and fix the 401 in the new action only
Current likely cause from the code:
- `hubspot-api` always tries connector-gateway first when connector secrets exist.
- In `team_briefing_summary`, that means the new action is currently calling the connector route, not the stored company token route.
- The user-provided private app token lives in `company_integrations`, and the requested behavior is to send it directly as `Authorization: Bearer <token>` to `https://api.hubapi.com`.
- So the 401 is most likely happening because the new action is using the wrong credential path for this Team Briefing fetch, even though the stored-token direct path already exists in the function.

Implementation approach:
- In `supabase/functions/hubspot-api/index.ts`, keep `status` and existing `briefing_summary` behavior untouched.
- For `action === "team_briefing_summary"` only:
  - read the stored token from `company_integrations`
  - decode it the same way the function already does
  - trim/sanitize the token before request assembly
  - call `https://api.hubapi.com/...` through the existing `hubspotApi()` helper
  - send `Authorization: Bearer <token>` explicitly
- Preserve existing gateway verification / auth behavior for the old actions.
- Do not change the existing auth flow for other actions.

3. Keep Team Briefing backend wiring but ensure the richer fields survive normalization
- In `supabase/functions/ceo-briefing/index.ts`, keep the Team Briefing call to `action: "team_briefing_summary"`.
- Ensure normalization preserves and forwards all new CRM arrays/counts into `parsed.payload.hubspot_signal`, including:
  - `active_deals`
  - `active_deals_count`
  - `at_risk_accounts_details`
  - `at_risk_accounts_count`
  - `key_contacts`
- Keep backward-compatible summary fields already used by the existing HubSpot card:
  - `accounts_scanned`
  - `stale_deals`
  - `at_risk_accounts`
  - `metrics_summary`
  - `summary`
  - `degraded_reason`

4. Render the new CRM detail blocks inside the existing HubSpot card
- Update the HubSpot rendering branch in `CommsPulseCard.tsx` so the one HubSpot card includes:
  - existing header/status/metrics
  - existing narrative summary
  - inline CRM detail section below that content
- Use compact internal subsections rather than a second bordered wrapper.
- Keep empty-state handling inside the same card:
  - not connected → blind spot message
  - degraded → partial data message
  - connected but empty → “no material CRM items surfaced”
- Do not create a new card, wrapper, or separate component.

5. Verify the fix after implementation
- Confirm only one HubSpot card appears in Team Briefing.
- Confirm that card now contains:
  - top summary metrics
  - active deals
  - at-risk accounts
  - key contacts
- Confirm `team_briefing_summary` no longer 401s when a stored company token exists.
- Confirm `status` and existing `briefing_summary` responses remain unchanged.

Technical details
- Files to update:
  - `src/components/ceo/CommsPulseCard.tsx`
  - `supabase/functions/hubspot-api/index.ts`
  - `supabase/functions/ceo-briefing/index.ts`
- No database migration needed.
- No changes to CEO Briefing’s existing `briefing_summary` action.
- No new component/card should be introduced.

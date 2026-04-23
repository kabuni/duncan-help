
Goal: add HubSpot CRM coverage to Team Briefing without changing CEO Briefing behavior or the existing `briefing_summary` action.

1. Extend `hubspot-api` with a new additive action
- Add a new `action: "team_briefing_summary"` branch in `supabase/functions/hubspot-api/index.ts`.
- Reuse the existing auth flow exactly as-is:
  - connector gateway first when available
  - stored company token fallback from `company_integrations`
- Keep `status` and `briefing_summary` untouched.
- For the new action only, fetch:
  - contacts: key fields like name, email, company, lifecycle/owner, last activity
  - deals: name, stage, amount, owner, close date, last modified
  - companies when needed for account risk context
- Return a richer payload shaped for Team Briefing UI:
  - `active_deals_count`
  - `active_deals[]`
  - `at_risk_accounts_count`
  - `at_risk_accounts[]`
  - `key_contacts[]`
  - existing status metadata (`status`, `connected`, `credential_source`, `error_code`, `error_message`, `metrics_summary`, etc.)

2. Define deterministic CRM signal rules for the new action
- Keep the logic server-side and explicit.
- Suggested rules:
  - Active deals = open deals not in closed won/lost stages.
  - At-risk accounts = accounts tied to stale open deals, overdue/no recent activity, or low health/score signals when available.
  - Key contacts = most relevant contacts attached to open deals / priority accounts, ranked by recency + ownership + associated revenue impact.
- Make the action degrade gracefully:
  - if one dataset is empty, continue
  - if contacts are missing, still return deals/accounts
  - if HubSpot is unavailable, return degraded metadata with empty arrays, not a hard failure

3. Wire the new action into the Team Briefing backend only
- Update `supabase/functions/ceo-briefing/index.ts` only where the Team Briefing payload is assembled.
- Replace the Team Briefing HubSpot fetch call from `action: "briefing_summary"` to `action: "team_briefing_summary"` for this backend path only.
- Preserve the existing normalization/fallback pattern already used for external signals.
- Do not alter CEO scoring logic, briefing generation flow, or any existing `briefing_summary` consumers.

4. Add the richer HubSpot payload into the Team Briefing response
- Continue populating `parsed.payload.hubspot_signal`.
- Extend that payload with the new arrays/counts:
  - `active_deals`
  - `active_deals_count`
  - `at_risk_accounts`
  - `at_risk_accounts_count`
  - `key_contacts`
- Keep backward-compatible fields like `accounts_scanned`, `stale_deals`, `at_risk_accounts`, `summary`, and `metrics_summary` so existing UI sections do not break.

5. Update Team Briefing UI to surface CRM details
- Keep the existing Comms/Signals summary intact.
- Add a dedicated HubSpot detail section in Team Briefing UI, likely within `src/components/ceo/CommsPulseCard.tsx` or as a small new Team Briefing subcomponent if cleaner.
- Show three compact blocks:
  - Active deals
  - At-risk accounts
  - Key contacts
- Each block should have:
  - count in header
  - concise rows/cards
  - empty-state text when connected but no records
  - degraded/not-configured state messaging aligned with current Team Briefing UX

6. Use the provided token through the existing company integration pattern
- Do not hardcode the token in frontend code or in the function file.
- Store it using the existing company integration mechanism for HubSpot so `hubspot-api` can keep using its current stored-token fallback path.
- This keeps the implementation aligned with the current architecture and avoids touching working CEO logic.

7. Validation after implementation
- Verify `hubspot-api` returns:
  - unchanged results for `status`
  - unchanged results for `briefing_summary`
  - new structured data for `team_briefing_summary`
- Verify Team Briefing still loads when:
  - HubSpot is connected with data
  - HubSpot is connected but has sparse/no contact data
  - HubSpot is unavailable or invalid
- Confirm the UI shows:
  - active deals
  - at-risk accounts
  - key contacts
  without affecting the rest of Team Briefing.

Technical details
- Files to update:
  - `supabase/functions/hubspot-api/index.ts`
  - `supabase/functions/ceo-briefing/index.ts`
  - `src/components/ceo/CommsPulseCard.tsx` and/or a new small Team Briefing HubSpot component
  - optionally `src/pages/CEOBriefing.tsx` only if a new section component needs mounting
- No database schema changes should be required.
- No changes to:
  - CEO Briefing access rules
  - existing `briefing_summary`
  - existing `status`
- HubSpot endpoints likely used:
  - `/crm/v3/objects/contacts`
  - `/crm/v3/objects/deals`
  - optionally `/crm/v3/objects/companies`
  - optionally associations if needed for linking contacts to deals/accounts
- The safest implementation is additive: new action + new Team Briefing payload fields + new UI rendering only.

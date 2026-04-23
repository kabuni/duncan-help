
Goal: eliminate the HubSpot `team_briefing_summary` 401 by fixing the actual credential path and internal auth path, while adding the requested token diagnostics and preserving the existing working HubSpot flows.

1. Fix the real 401 cause first: internal auth mismatch on the Team Briefing call
- Update `supabase/functions/hubspot-api/index.ts` so the function can accept the Team Briefing backend invocation without failing before token lookup.
- Current issue: `ceo-briefing` calls `hubspot-api` with `Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, but `hubspot-api` currently runs `auth.getUser()` on that header and rejects it as unauthorized because it is not a user JWT.
- Keep the normal end-user auth behavior intact.
- Add a narrow internal-call path for trusted backend invocations so `team_briefing_summary` can run when called from the Team Briefing backend.
- Do not change the existing connector/stored-token behavior for `status` or `briefing_summary`.

2. Add explicit token diagnostics inside `team_briefing_summary`
- In `supabase/functions/hubspot-api/index.ts`, only inside `action === "team_briefing_summary"`:
  - log whether a `company_integrations` row was found for `integration_id = "hubspot"`
  - log whether `encrypted_api_key` is null, empty, or present
  - log token length and a safe prefix for the encoded value only
  - decode with `atob()`
  - log whether decode succeeded
  - log the first 10 characters of the decoded token only after trimming
  - log final token length after trim
- If decode fails, log that branch clearly and return a degraded/not-configured response instead of silently continuing.

3. Add fallback to backend secret when stored token is absent or undecodable
- Still in `team_briefing_summary` only:
  - try stored token from `company_integrations` first
  - if missing or decode fails, fall back to `HUBSPOT_API_KEY`
  - log which source was actually selected: `stored_token` or `env_secret`
- Preserve the old behavior for the existing `status` and `briefing_summary` paths unless absolutely necessary.

4. Guarantee the Authorization header is assembled exactly once and correctly
- Centralize the final token normalization before requests:
  - trim whitespace
  - reject empty string after trim
- Ensure the outbound request uses exactly:
  - `Authorization: Bearer <decoded_token>`
- Add a debug log that confirms the header mode is `Bearer` and the token length/prefix being used, without logging the full secret.

5. Keep Team Briefing on direct HubSpot API for this action
- For `team_briefing_summary`, continue bypassing the connector route and call `https://api.hubapi.com` directly.
- Reuse the existing `hubspotApi()` helper, but ensure the token passed into it is the decoded+trimmed token selected from stored token or env fallback.
- Keep connector-gateway logic untouched for the other actions.

6. Verify how the Integrations page stores the token
- Inspect and, if needed, adjust the company integration save path:
  - `src/pages/Integrations.tsx`
  - `src/hooks/useCompanyIntegrations.ts`
  - `supabase/functions/manage-company-integration/index.ts`
- Current code already sends the token through `manage-company-integration`, which base64-encodes it and upserts into `company_integrations` by `integration_id`.
- Important: the current schema does not have a `company_id` column on `company_integrations`, so there is no “right company_id” to save. The correct validation target is:
  - `integration_id = 'hubspot'`
  - `encrypted_api_key` present
  - `status`
  - `updated_by`
  - `last_sync`
- If needed, tighten the connect flow so the saved token is trimmed before verification/upsert to avoid accidental whitespace problems.

7. Keep Team Briefing payload behavior unchanged except for auth reliability
- No UI restructuring needed for this fix if the unified card is already correct.
- Keep `ceo-briefing` calling `action: "team_briefing_summary"`.
- If internal auth support is added in `hubspot-api`, `ceo-briefing` can stay as-is unless a safer internal header pattern is needed.

8. Validation after implementation
- Confirm `team_briefing_summary` no longer returns 401 when invoked by Team Briefing.
- Confirm logs show one of these branches clearly:
  - stored token found and decoded
  - stored token missing, env fallback used
  - stored token decode failed, env fallback used
- Confirm outbound HubSpot requests are using direct API calls with Bearer auth.
- Confirm `status` and existing `briefing_summary` responses still behave exactly as before.
- Confirm the Integrations page still saves/replaces the HubSpot token into `company_integrations` successfully.

Technical details
- Files to update:
  - `supabase/functions/hubspot-api/index.ts`
  - possibly `supabase/functions/ceo-briefing/index.ts` only if internal-call auth needs a matching trusted header convention
  - `supabase/functions/manage-company-integration/index.ts` only if token trimming/logging on save is needed
- No database migration required.
- No `company_id` change required because `company_integrations` currently has no company scoping column.
- The most likely root cause is not the token value itself; it is that `hubspot-api` is rejecting the Team Briefing backend request before the stored token path is fully used.

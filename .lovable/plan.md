
Plan: make HubSpot Team Briefing credential resolution diagnostic and reversible without changing Team Briefing behavior.

## Scope

Only update the HubSpot credential/debug path and the Integrations save logging path:

- `supabase/functions/hubspot-api/index.ts`
- `src/hooks/useCompanyIntegrations.ts`
- `src/pages/Integrations.tsx` only if the hook-level logging is not enough for clear UI-side evidence

No database migration, no Team Briefing UI redesign, no schema/tool/frontend orchestration changes.

## Current evidence from code

- `team_briefing_summary` is handled in `supabase/functions/hubspot-api/index.ts` around lines 598–628.
- It calls `resolveTeamBriefingToken(HUBSPOT_API_KEY)`, which calls `getStoredToken()`.
- `getStoredToken()` currently queries:

```ts
.from("company_integrations")
.select("encrypted_api_key, status, last_sync")
.eq("integration_id", "hubspot")
.maybeSingle()
```

- It logs token state, but the final missing-token response currently collapses multiple root causes into a generic `hubspot_not_configured`.
- `HUBSPOT_API_KEY` is read from runtime env, but the response does not clearly state whether the env fallback was present or absent.
- The Integrations save path goes through `useUpdateCompanyIntegration()` → `manage-company-integration`, and `manage-company-integration` upserts `integration_id` exactly as provided. The frontend does not currently log the returned saved row details.

## Implementation steps

### 1. Strengthen the direct company integration lookup

In `supabase/functions/hubspot-api/index.ts`, update `getStoredToken()` to return a more explicit diagnostic object:

- Include `integration_id`, `status`, `last_sync`, and `updated_at` in the select.
- Capture query errors separately.
- Distinguish these states:
  - `integration_not_configured`: no row returned for `integration_id = 'hubspot'`
  - `no_token_stored`: row exists but `encrypted_api_key` is `null` or empty
  - `token_decode_failed`: row exists and token exists but base64 decode fails
  - `token_found`: row exists and decoded token is non-empty
- Log safe details only:
  - row found yes/no
  - integration_id returned
  - status
  - last_sync
  - updated_at
  - encrypted token state: `null`, `empty`, or `present`
  - encoded length and safe prefix
  - decoded length and safe prefix
  - decode success/failure
  - query error message/code if any

No full token will be logged.

### 2. Make `team_briefing_summary` return exact credential diagnostics

In the `action === "team_briefing_summary"` branch:

- Keep the current service-role internal-call path unchanged.
- Before choosing credentials, log:
  - `company_integrations` lookup result state
  - whether `HUBSPOT_API_KEY` exists
  - which source was selected
- Preserve priority:
  1. stored token from `company_integrations.integration_id = 'hubspot'`
  2. fallback runtime secret `HUBSPOT_API_KEY`
- If stored token is usable, return/use:
  - `credential_source: "stored_token"`
- If stored row exists but token is empty/null and env fallback exists:
  - use env fallback immediately
  - log `selected_source: "env_secret"`
  - include diagnostics showing stored row state was `no_token_stored`
- If stored row does not exist and env fallback exists:
  - use env fallback immediately
  - log `selected_source: "env_secret"`
  - include diagnostics showing stored row state was `integration_not_configured`
- If no usable token exists:
  - return a non-breaking degraded/not-configured JSON response with a precise code:
    - `integration_not_configured` if no row exists and no env fallback exists
    - `no_token_stored` if row exists but `encrypted_api_key` is null/empty and no env fallback exists
    - `stored_token_decode_failed` if token exists but cannot decode and no env fallback exists
  - include `credential_source: "none"`
  - include `degraded_reason` / `error_message` with the exact reason

This keeps Team Briefing from breaking while making the root cause visible in logs and payload.

### 3. Add explicit env fallback logging

Still in `hubspot-api`:

- Log `HUBSPOT_API_KEY` presence as a boolean only.
- If used, log:
  - `selected_source: "env_secret"`
  - `header_mode: "Bearer"`
  - token length and safe prefix only
- Do not log the full secret.

### 4. Add save-path confirmation after HubSpot token save

In `src/hooks/useCompanyIntegrations.ts`, update the mutation success path to log the backend response from `manage-company-integration`:

- `requested_integration_id`
- returned `integration.integration_id`
- returned `integration.status`
- whether `integration.encrypted_api_key` is present if returned
- `verification.status`
- `verification.error_code`
- whether the saved key matches `hubspot`

Because the hook already receives the mutation result, this can be done without changing the Integrations page UI.

If the hook response does not include enough information, add a narrowly scoped log in `src/pages/Integrations.tsx` after:

```ts
await companyMutation.mutateAsync({ integrationId: integration.id, apiKey: trimmedApiKey });
```

for HubSpot only.

### 5. Preserve existing behavior

Do not change:

- Team Briefing rendering
- `CommsPulseCard`
- `ceo-briefing`
- tool schemas
- OpenAI/Claude routing
- HubSpot API request paths
- database schema
- auth model
- integration card design

The only user-visible change should be clearer Team Briefing HubSpot status/reason/code when credentials are missing or not found.

## Expected result

When Team Briefing calls HubSpot:

- If `company_integrations` has no `hubspot` row, payload/logs will say `integration_not_configured`.
- If the row exists but token is empty/null, payload/logs will say `no_token_stored`.
- If the row exists with a usable token, logs will show `token_found` and `credential_source: "stored_token"`.
- If `HUBSPOT_API_KEY` exists and stored token is unusable/missing, logs will show env fallback used and Team Briefing will use `credential_source: "env_secret"`.
- If HubSpot still returns 401 after a token is found, the failure will be clearly separated from “token not found” and classified as invalid/expired/insufficient-scope rather than “No credential.”

## Verification after approval

After implementation, verify:

1. Save a HubSpot token from Integrations and confirm console log shows:
   - requested `integration_id = "hubspot"`
   - returned `integration_id = "hubspot"`
   - save succeeded
2. Run Team Briefing and inspect HubSpot function logs for:
   - direct `company_integrations` lookup state
   - stored token state
   - env fallback availability
   - selected credential source
3. Confirm Team Briefing no longer shows `Source: No credential` unless both:
   - no usable `company_integrations` token exists
   - no `HUBSPOT_API_KEY` fallback exists
4. Confirm no other integrations or Team Briefing sections are affected.

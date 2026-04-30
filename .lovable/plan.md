# Fix: Restrict `company_integrations` SELECT to authenticated users

## Goal (scope = 1b only)

Close the public-read hole on `public.company_integrations` so anonymous (`anon`) users can no longer read the table (which currently exposes Base64-encoded HubSpot/GitHub/Notion tokens). Admin write access stays untouched. No other hardening (encryption, column masking, token rotation) is included in this step — those are explicitly out of scope per your instruction.

## Current state (verified against the live DB)

Policies on `public.company_integrations`:

```text
Admins can manage company integrations | roles: {public} | ALL  | USING has_role(auth.uid(),'admin')
Everyone can view company integrations  | roles: {public} | SELECT | USING true
```

The second policy is the problem: `public` role + `USING true` means PostgREST serves the entire table to the `anon` JWT.

## Change

A single migration that:

1. Drops `"Everyone can view company integrations"`.
2. Creates a replacement SELECT policy scoped to the `authenticated` role only.
3. Leaves the existing admin ALL policy in place (admins are also authenticated, so they keep full access).

The `anon` role will no longer match any SELECT policy → reads return zero rows / 401-style empty result via PostgREST.

## Migration SQL

```sql
-- Restrict company_integrations SELECT to authenticated users only.
-- Removes public/anon read access to API tokens stored in this table.

DROP POLICY IF EXISTS "Everyone can view company integrations"
  ON public.company_integrations;

CREATE POLICY "Authenticated users can view company integrations"
  ON public.company_integrations
  FOR SELECT
  TO authenticated
  USING (true);
```

Notes:
- `TO authenticated` is the key change vs. the old policy (which targeted `public`, implicitly including `anon`).
- `USING (true)` preserves current app behaviour for logged-in users — `useCompanyIntegrations` (`src/hooks/useCompanyIntegrations.ts`) keeps working for any signed-in user, just not for anonymous visitors.
- The existing `"Admins can manage company integrations"` ALL policy is untouched, so admin writes via `manage-company-integration` continue to work (that edge function uses the service role anyway, which bypasses RLS).

## Impact / regressions to expect

- `anon` (logged-out) clients calling `from('company_integrations').select(...)` will now get an empty result. No code path in the app does this from a logged-out state — `Integrations.tsx` is behind `ProtectedRoute`.
- All authenticated users can still *see metadata* (id, integration_id, status, last_sync, documents_ingested, encrypted_api_key, etc.). The `encrypted_api_key` column is still readable by any authenticated user and is still only Base64. That is intentional for this step — narrowing to admin-only and replacing Base64 with real encryption are tracked for the follow-up phase you asked me to defer.

## Out of scope (explicitly not in this migration)

- Restricting SELECT to admins only.
- Hiding/removing the `encrypted_api_key` column from SELECT.
- Replacing Base64 with real encryption (pgsodium / Vault).
- Rotating the currently exposed HubSpot, GitHub, Notion tokens.

Awaiting approval to switch to build mode and create the migration file.

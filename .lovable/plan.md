## Goal
Restore Azure Repos / Azure DevOps access in the CEO briefing by getting a fresh OAuth token. The current `access_token` expired on **2026-05-07** and the stored `refresh_token` is also no longer valid (it hasn't successfully refreshed since 15 March), so the existing refresh logic cannot recover on its own — a human must re-authorise via Microsoft.

## Diagnosis (already confirmed)
- `azure_devops_tokens` row: `token_expiry = 2026-05-07 13:24:31`, `updated_at = 2026-03-15` → refresh has been failing silently.
- `azure-repos-api` and `ceo-briefing` logs show `401 Unauthorized` from Azure DevOps.
- OAuth credentials (`AZURE_DEVOPS_CLIENT_ID`, `AZURE_DEVOPS_CLIENT_SECRET`, `AZURE_TENANT_ID`, `AZURE_DEVOPS_ORG_URL`) are all still configured as Lovable Cloud secrets — so the app registration in Microsoft Entra is fine, only the user's consent / refresh token needs renewing.
- A working OAuth flow already exists: `azure-devops-auth` (initiate) → `azure-devops-callback` (store tokens). It is admin-gated and is wired into `src/pages/Integrations.tsx`.

## Steps for you (the user)
1. Sign in to Duncan as an **admin** (required by `azure-devops-auth`).
2. Open **Integrations** in the left sidebar.
3. Find the **Azure DevOps** card and click **Connect** (or Reconnect).
4. You'll be sent to `login.microsoftonline.com` — sign in with the Kabuni account that owns the Azure DevOps org and approve the consent prompt (`user_impersonation` + `offline_access`).
5. Microsoft redirects back to `azure-devops-callback`, which writes a fresh `access_token` + `refresh_token` into `azure_devops_tokens`.

## Verification I will run after you reconnect
- Read `azure_devops_tokens` and confirm `updated_at` is current and `token_expiry` is ~1 hour in the future.
- Hit `azure-repos-api` with `team_activity_summary` and confirm a 200 response (no more 401).
- Re-trigger / inspect the next `ceo-briefing` run and confirm `azure_repos: ok` instead of `degraded (HTTP 401)`.

## Optional follow-up (not part of this fix, flag only)
The silent failure happened because nothing alerts when the nightly refresh dies. We could later add a tiny health check (or surface refresh failures on the Integrations card) so the next expiry doesn't go unnoticed for weeks. Tell me if you want that as a follow-up task.

## What I will NOT do
- Touch the OAuth code, the token table, or the secrets — none of those are the cause.
- Re-authorise on your behalf — only you can complete the Microsoft consent.
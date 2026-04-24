
## Plan: Fix the two blockers for GitHub in Team Briefing

### Scope

Only change the two requested areas:

1. `supabase/functions/github-api/index.ts`
2. GitHub company-token save path used by `src/pages/Integrations.tsx`

No changes to:

- Team Briefing UI
- `ceo-briefing` orchestration
- GitHub payload shape
- PR/repo scanning logic
- scanning limits
- unrelated integrations

---

## Fix 1: Allow internal service-role calls in `github-api`

### Current failure

`ceo-briefing` calls:

```ts
/functions/v1/github-api
Authorization: Bearer SUPABASE_SERVICE_ROLE_KEY
body: { action: "briefing_summary" }
```

But `github-api` currently does this:

```ts
const user = await getUser(req);
if (!user) return json({ error: "Unauthorized" }, 401);
```

A service-role token is not a normal user session, so `getUser(req)` returns no user and Team Briefing receives HTTP 401.

### Change

Add a narrow internal-call check in `github-api`:

- Read the `Authorization` header
- Compare the bearer token to `SUPABASE_SERVICE_ROLE_KEY`
- If it matches, allow the request through
- If it does not match, keep the existing `getUser(req)` auth gate

Conceptually:

```ts
function isServiceRoleRequest(req: Request) {
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  return !!token && token === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
}
```

Then:

```ts
const isInternal = isServiceRoleRequest(req);

if (!isInternal) {
  const user = await getUser(req);
  if (!user) return json({ error: "Unauthorized" }, 401);
}
```

This fixes the internal Team Briefing call without removing auth for normal callers.

---

## Fix 2: Ensure GitHub company token saves into `company_integrations`

### Current state

GitHub is already listed as a company integration in `src/pages/Integrations.tsx`.

The UI already routes company-token saves through:

```ts
useUpdateCompanyIntegration()
```

That hook calls:

```ts
manage-company-integration
```

The backend function already supports `integration_id === "github"` and verifies against:

```ts
https://api.github.com/user
```

Then it upserts:

```ts
company_integrations.integration_id = integration_id
company_integrations.encrypted_api_key = btoa(token)
company_integrations.status = verification status
```

### Change

Make the GitHub save path explicit and verifiable:

- Keep using the existing company integration mutation
- Ensure GitHub saves with exactly:

```ts
integrationId: "github"
```

- Add GitHub-specific confirmation logging in `src/hooks/useCompanyIntegrations.ts`, parallel to the existing HubSpot logging, so we can confirm:

```ts
requested_integration_id: "github"
returned_integration_id: "github"
returned_status
returned_encrypted_api_key_present
verification_status
verification_error_code
saved_key_matches_github
```

This confirms whether the Integrations page actually created or updated the required row:

```text
company_integrations.integration_id = "github"
```

No new UI will be added.

---

## Verification

After implementation:

1. Save a GitHub token from Integrations.
2. Confirm browser console logs show:
   - requested integration ID is `github`
   - returned integration ID is `github`
   - encrypted key exists
   - save matched GitHub
3. Run Team Briefing.
4. Confirm `github-api` no longer returns HTTP 401 for the internal `ceo-briefing` call.
5. Confirm GitHub returns either:
   - `connected` with repo/PR metrics, or
   - a provider-level degraded status such as invalid token / missing scope
6. Confirm Team Briefing payload shape and UI remain unchanged.


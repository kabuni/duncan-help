## Diagnosis

The error "Failed to decode base64" is **not** in `norman-chat/index.ts`. I audited it — the only `atob()` left there is at line 3625 and is unrelated JWT base64url decoding.

The actual culprits are two **other** edge functions that `norman-chat` invokes during chat (HubSpot/GitHub tool calls):

- `supabase/functions/hubspot-api/index.ts` — `getStoredToken()` line 247: `atob(encodedToken)`
- `supabase/functions/github-api/index.ts` — `getStoredToken()` line 145: `atob(data.encrypted_api_key)`

Both still read `encrypted_api_key` directly from `company_integrations` and `atob()` it. After the Vault migration that column holds a UUID like `7c1a...-...-...`. Hyphens are invalid base64 → `atob()` throws "Failed to decode base64" → bubbles up as the chat error you see.

`norman-chat`'s `getNotionToken` is already on the new RPC, which is why it wasn't caught.

## Scope of the fix

Only these two files. No DB changes — the RPC `public.get_company_integration_secret` and the Vault secrets already exist from the previous migration, and the GitHub + HubSpot rows were backfilled into Vault in that pass.

### `supabase/functions/hubspot-api/index.ts`

In `getStoredToken()` (lines ~167–304), replace the direct `select("encrypted_api_key, ...")` + `atob()` block with a service-role RPC call:

```ts
const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

// Metadata row (status / last_sync / updated_at / integration_id) — no secret material.
const { data: meta, error } = await supabase
  .from("company_integrations")
  .select("integration_id, status, last_sync, updated_at, encrypted_api_key")
  .eq("integration_id", "hubspot")
  .maybeSingle();

// (existing error / not-found / no-token logging branches stay, but key off `meta` instead of `data`,
//  and replace `encodedState` checks with "is encrypted_api_key non-empty?" — it now holds a Vault UUID.)

// Plaintext via Vault RPC.
const { data: token, error: vaultErr } = await supabase.rpc(
  "get_company_integration_secret",
  { p_integration_id: "hubspot" },
);

if (vaultErr || !token) {
  // log as token_decode_failed-equivalent ("vault_lookup_failed") and return state with token: null.
} else {
  // return state: "token_found", token: token as string, decodeOk: true.
}
```

Keep all the existing `logHubspot(...)` calls and the returned shape (`StoredTokenState`, `rowFound`, `integrationId`, `encodedToken`, `token`, `decodeOk`, `lastSync`, `storedStatus`, `updatedAt`, `queryError`) so downstream code in `hubspot-api` keeps compiling. `encodedToken` becomes the Vault UUID string (purely diagnostic — only its presence matters now). `decode_*` log fields get repurposed to `vault_*` equivalents.

### `supabase/functions/github-api/index.ts`

In `getStoredToken()` (lines 133–156), replace the body with:

```ts
const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const { data: meta } = await supabase
  .from("company_integrations")
  .select("status, last_sync, encrypted_api_key")
  .eq("integration_id", "github")
  .maybeSingle();

if (!meta?.encrypted_api_key) return null;

const { data: token, error } = await supabase.rpc(
  "get_company_integration_secret",
  { p_integration_id: "github" },
);

if (error || !token) {
  return { token: null, lastSync: meta.last_sync ?? null, storedStatus: meta.status ?? null };
}

return { token: token as string, lastSync: meta.last_sync ?? null, storedStatus: meta.status ?? null };
```

## Out of scope (not touched)

- `nda-generate`, `nda-send-signature`, `docusign-webhook` — still call `atob(encrypted_api_key)` but are decommissioned dead code (per project memory). They will simply continue to be broken, which is fine since nothing invokes them.
- `connect-integration/index.ts` line 76 — that's a *write* path that stores `api_key` raw (no `atob`). Worth flagging as a separate cleanup item but it isn't causing the chat failure, so I'll leave it alone in this pass.
- `norman-chat/index.ts` — already clean. No edits.
- The Vault RPCs and DB schema — unchanged.

## Verification after applying

1. Open Duncan chat → send any message → should respond (no base64 error).
2. Ask Duncan something HubSpot-flavoured (e.g. "What deals are in HubSpot this week?") → tool call should return real data, not "token_decode_failed".
3. Same for GitHub.
4. Check `supabase--edge_function_logs` for `hubspot-api` / `github-api` → look for `state: "token_found"` and absence of `Failed to decode base64`.

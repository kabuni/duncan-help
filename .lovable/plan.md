## What's actually broken

Your diagnosis (one side uses `btoa`, the other uses Vault) is **not** what the code shows. Both sides are already on Vault:

- `manage-company-integration/index.ts` line 281 calls `set_company_integration_secret` RPC.
- `hubspot-api/index.ts` line 246 calls `get_company_integration_secret` RPC.
- There is no `btoa()` anywhere in `manage-company-integration`.

The real problem is in the `set_company_integration_secret` SQL function, and I confirmed it from the database:

- `public.company_integrations` row for `hubspot` has `status = 'connected'`, `last_sync` updated today, but `encrypted_api_key IS NULL`.
- A valid vault secret exists (`company_integration:hubspot:...`) from earlier today, but the row no longer points to it.

### Why the RPC returns NULL

Current `set_company_integration_secret`:

```sql
select encrypted_api_key into v_existing
  from public.company_integrations
  where integration_id = p_integration_id;

begin
  v_secret_id := v_existing::uuid;                          -- v_existing is NULL  -> v_secret_id := NULL
  perform vault.update_secret(v_secret_id, p_plaintext);    -- update with NULL id: no-op, no exception
exception when others then
  v_secret_id := vault.create_secret(...);                  -- never reached
end;

return v_secret_id;                                         -- returns NULL
```

Once the column is ever NULL (which it is right now), every reconnect:
1. RPC returns NULL.
2. `manage-company-integration` upserts `encrypted_api_key = NULL`.
3. `hubspot-api` sees `encrypted_api_key_state = "null"` -> returns `no_token_stored` -> UI shows "key is null / decode failed".

This explains every symptom in your message without any storage mismatch.

## Fix

### 1. Patch the `set_company_integration_secret` RPC (migration)

Treat a NULL or non-UUID `v_existing` as "no existing secret, create a new one." Also coerce `vault.update_secret`'s return so we never propagate NULL when the path "succeeded." New body:

```sql
declare
  v_existing text;
  v_secret_id uuid;
begin
  select encrypted_api_key into v_existing
    from public.company_integrations
    where integration_id = p_integration_id;

  if v_existing is not null and v_existing <> '' then
    begin
      v_secret_id := v_existing::uuid;
      perform vault.update_secret(v_secret_id, p_plaintext);
    exception when others then
      v_secret_id := null;  -- fall through to create
    end;
  end if;

  if v_secret_id is null then
    v_secret_id := vault.create_secret(
      p_plaintext,
      'company_integration:' || p_integration_id || ':' || gen_random_uuid()::text,
      'API key for company integration ' || p_integration_id
    );
  end if;

  return v_secret_id;
end;
```

Net effect: the function can never return NULL on success. It will always either reuse the existing vault secret or create a new one and return its UUID.

### 2. Defensive guard in `manage-company-integration/index.ts`

Right after the RPC call (around line 284), if `vaultSecretId` is null/empty, throw a clear error instead of upserting NULL into the column:

```ts
if (!vaultSecretId || typeof vaultSecretId !== "string") {
  console.error("[manage-company-integration] vault returned empty secret id", { vaultSecretId });
  throw new Error("Failed to persist integration secret to vault");
}
```

This prevents this class of bug from ever silently re-occurring.

### 3. Re-link the existing orphaned vault secret (one-time data fix)

The current row is broken right now. The migration above only fixes future reconnects — the row's `encrypted_api_key` is still NULL, so the next call to `hubspot-api` will keep failing until you reconnect once. Two options:

- **Preferred (zero user action):** in the same migration, point the existing row at the orphaned vault secret already in `vault.secrets`:
  ```sql
  update public.company_integrations
  set encrypted_api_key = (
    select id::text from vault.secrets
    where name like 'company_integration:hubspot:%'
    order by updated_at desc limit 1
  )
  where integration_id = 'hubspot' and encrypted_api_key is null;
  ```
  This restores the connection without you needing to paste the token again, assuming the vault secret still holds the correct (and `forms`-scoped) token.

- **Alternative:** skip the data fix; you reconnect HubSpot once after the migration deploys. The fixed RPC will create a fresh vault secret and write its UUID into the row correctly.

I'll include the data fix in the migration since it costs nothing if the vault secret happens to be stale (you'd just reconnect anyway).

## Verification after applying

1. `select integration_id, status, encrypted_api_key from public.company_integrations where integration_id='hubspot';` — `encrypted_api_key` must now be a UUID, not NULL.
2. Open CEO Briefing -> trigger any HubSpot card. `hubspot-api` logs should show `state: "token_found"`, `vault_lookup_ok: true`.
3. Disconnect + reconnect HubSpot from the Integrations page. Re-run query in step 1 — `encrypted_api_key` should still be a non-null UUID.
4. If still 403 on Forms, that's the separate `forms` scope issue from earlier — unrelated to this fix.

## Out of scope

- Changing the storage scheme (`btoa` vs Vault). Both sides are already on Vault and that's the right design.
- Touching `hubspot-api` retrieval logic — the existing code already handles the happy path correctly once the column is populated.

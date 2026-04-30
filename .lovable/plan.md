## Goal

Replace fake base64 "encryption" of `company_integrations.encrypted_api_key` with **Supabase Vault** (the supported successor to pgsodium TCE — pgsodium itself is not installed and is deprecated by Supabase, you confirmed Vault).

After this change:
- The ciphertext never sits in `public.company_integrations`.
- Edge functions resolve the plaintext token by looking up `vault.decrypted_secrets` via the service role.
- The `public` schema only stores a Vault secret UUID — useless on its own even if RLS leaks.

## Scope

**Migrating (2 files — active code paths):**
1. `supabase/functions/manage-company-integration/index.ts` — writer
2. `supabase/functions/norman-chat/index.ts` — reader (Notion token, line 3348 `getNotionToken`)

**Not migrating (3 files — decommissioned per project memory: "Legal/NDA tools — do not re-add"):**
- `supabase/functions/nda-generate/index.ts`
- `supabase/functions/nda-send-signature/index.ts`
- `supabase/functions/docusign-webhook/index.ts`

These edge functions are dead code for the decommissioned NDA/DocuSign tooling. Touching them now would resurrect imports and surface area for code we're supposed to be retiring. If you want them migrated anyway (or deleted), say so and I'll do it in the same pass.

## Database changes (one migration)

Repurpose the existing `encrypted_api_key TEXT` column to hold the Vault secret UUID (as text). No new column, no schema breakage for unrelated code.

```sql
-- 1. Helper: upsert plaintext into vault and return the secret UUID.
--    SECURITY DEFINER so edge functions calling with anon/auth role can't,
--    only service_role can EXECUTE (granted explicitly).
create or replace function public.set_company_integration_secret(
  p_integration_id text,
  p_plaintext text
) returns uuid
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_existing text;
  v_secret_id uuid;
begin
  select encrypted_api_key into v_existing
  from public.company_integrations
  where integration_id = p_integration_id;

  -- If the existing value parses as a UUID, treat it as a vault secret id and update in place.
  begin
    v_secret_id := v_existing::uuid;
    perform vault.update_secret(v_secret_id, p_plaintext);
  exception when others then
    v_secret_id := vault.create_secret(
      p_plaintext,
      'company_integration:' || p_integration_id,
      'API key for company integration ' || p_integration_id
    );
  end;

  return v_secret_id;
end;
$$;

revoke all on function public.set_company_integration_secret(text, text) from public, anon, authenticated;
grant execute on function public.set_company_integration_secret(text, text) to service_role;

-- 2. Helper: read plaintext back. service_role only.
create or replace function public.get_company_integration_secret(
  p_integration_id text
) returns text
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_secret_ref text;
  v_plain text;
begin
  select encrypted_api_key into v_secret_ref
  from public.company_integrations
  where integration_id = p_integration_id and status = 'connected';

  if v_secret_ref is null then return null; end if;

  select decrypted_secret into v_plain
  from vault.decrypted_secrets
  where id = v_secret_ref::uuid;

  return v_plain;
exception when others then
  return null;
end;
$$;

revoke all on function public.get_company_integration_secret(text) from public, anon, authenticated;
grant execute on function public.get_company_integration_secret(text) to service_role;

-- 3. One-time backfill: migrate the 3 rows that currently hold base64 ciphertext
--    (hubspot, notion, github) into vault and replace encrypted_api_key with the UUID.
do $$
declare
  r record;
  v_plain text;
  v_id uuid;
begin
  for r in
    select integration_id, encrypted_api_key
    from public.company_integrations
    where encrypted_api_key is not null
      and length(encrypted_api_key) > 0
  loop
    -- Skip if it already looks like a UUID (idempotent re-run).
    begin
      perform r.encrypted_api_key::uuid;
      continue;
    exception when others then null;
    end;

    -- Decode base64. If decoding fails, skip and log.
    begin
      v_plain := convert_from(decode(r.encrypted_api_key, 'base64'), 'UTF8');
    exception when others then
      raise notice 'Skipping % — not valid base64', r.integration_id;
      continue;
    end;

    v_id := vault.create_secret(
      v_plain,
      'company_integration:' || r.integration_id,
      'Backfilled from base64 on ' || now()::text
    );

    update public.company_integrations
    set encrypted_api_key = v_id::text
    where integration_id = r.integration_id;
  end loop;
end $$;
```

After the backfill, the column physically contains a UUID for hubspot/notion/github; the actual tokens live in `vault.secrets` encrypted with the project's Vault root key.

## Edge function changes

### `manage-company-integration/index.ts` (line ~278–296)

Replace:

```ts
const encryptedKey = btoa(normalizedApiKey);
...
.upsert({ integration_id, encrypted_api_key: encryptedKey, ... })
```

With:

```ts
const { data: secretIdRow, error: secretErr } = await supabaseAdmin.rpc(
  "set_company_integration_secret",
  { p_integration_id: integration_id, p_plaintext: normalizedApiKey }
);
if (secretErr) throw secretErr;
const vaultSecretId = secretIdRow as string;

.upsert({ integration_id, encrypted_api_key: vaultSecretId, ... })
```

`supabaseAdmin` is already the service-role client, so the RPC is allowed.

### `norman-chat/index.ts` `getNotionToken` (line 3348–3359)

Replace:

```ts
const { data: integration } = await supabaseAdmin
  .from("company_integrations")
  .select("encrypted_api_key, status")
  .eq("integration_id", "notion")
  .single();
if (!integration || integration.status !== "connected" || !integration.encrypted_api_key) return null;
return atob(integration.encrypted_api_key);
```

With:

```ts
const { data: token, error } = await supabaseAdmin.rpc(
  "get_company_integration_secret",
  { p_integration_id: "notion" }
);
if (error || !token) return null;
return token as string;
```

The other `atob`/`btoa` calls in `norman-chat/index.ts` (lines 3625, etc.) and in `nda-send-signature/index.ts` (lines 71, 76, 122, 135, 144, 319) are **JWT/RSA/binary encoding for DocuSign and Slack signing** — unrelated to the encryption story. They are not touched.

## Security outcome

| Before | After |
|---|---|
| `encrypted_api_key` = base64 of token, anyone with table read → `atob()` → token | `encrypted_api_key` = Vault secret UUID; plaintext only retrievable via `service_role` RPC |
| RLS leak = full token leak | RLS leak = useless UUID |
| Decryption = `atob()` in any browser | Decryption = Vault root key inside Postgres |

## Rollout

1. Apply the migration (creates RPCs + backfills hubspot/notion/github into Vault in the same transaction).
2. Deploy the two updated edge functions.
3. Verify: call `manage-company-integration` to re-save Notion (round-trips through Vault), then send a Notion request via Duncan chat to confirm `getNotionToken` still returns the live token.

## Out of scope (not changed)

- The 3 NDA/DocuSign edge functions (decommissioned).
- `nda-send-signature` JWT/RSA `btoa`/`atob` (legitimate base64, not encryption).
- RLS policies on `company_integrations` (already fixed in previous step).
- Token rotation for hubspot/notion/github (recommended separately — they were exposed publicly until yesterday).

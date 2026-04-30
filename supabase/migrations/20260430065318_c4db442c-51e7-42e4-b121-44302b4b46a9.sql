-- 1. Writer helper: store plaintext in vault, return secret UUID.
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

  begin
    v_secret_id := v_existing::uuid;
    perform vault.update_secret(v_secret_id, p_plaintext);
  exception when others then
    v_secret_id := vault.create_secret(
      p_plaintext,
      'company_integration:' || p_integration_id || ':' || gen_random_uuid()::text,
      'API key for company integration ' || p_integration_id
    );
  end;

  return v_secret_id;
end;
$$;

revoke all on function public.set_company_integration_secret(text, text) from public;
revoke all on function public.set_company_integration_secret(text, text) from anon;
revoke all on function public.set_company_integration_secret(text, text) from authenticated;
grant execute on function public.set_company_integration_secret(text, text) to service_role;

-- 2. Reader helper: return plaintext from vault. service_role only.
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

  begin
    select decrypted_secret into v_plain
    from vault.decrypted_secrets
    where id = v_secret_ref::uuid;
  exception when others then
    return null;
  end;

  return v_plain;
end;
$$;

revoke all on function public.get_company_integration_secret(text) from public;
revoke all on function public.get_company_integration_secret(text) from anon;
revoke all on function public.get_company_integration_secret(text) from authenticated;
grant execute on function public.get_company_integration_secret(text) to service_role;

-- 3. One-time idempotent backfill: base64 ciphertext -> Vault.
do $$
declare
  r record;
  v_plain text;
  v_id uuid;
  v_is_uuid boolean;
begin
  for r in
    select integration_id, encrypted_api_key
    from public.company_integrations
    where encrypted_api_key is not null
      and length(encrypted_api_key) > 0
  loop
    -- Skip if already a UUID (already migrated).
    v_is_uuid := false;
    begin
      perform r.encrypted_api_key::uuid;
      v_is_uuid := true;
    exception when others then
      v_is_uuid := false;
    end;
    if v_is_uuid then
      continue;
    end if;

    begin
      v_plain := convert_from(decode(r.encrypted_api_key, 'base64'), 'UTF8');
    exception when others then
      raise notice 'Skipping % - not valid base64', r.integration_id;
      continue;
    end;

    v_id := vault.create_secret(
      v_plain,
      'company_integration:' || r.integration_id || ':' || gen_random_uuid()::text,
      'Backfilled from base64'
    );

    update public.company_integrations
    set encrypted_api_key = v_id::text
    where integration_id = r.integration_id;
  end loop;
end $$;
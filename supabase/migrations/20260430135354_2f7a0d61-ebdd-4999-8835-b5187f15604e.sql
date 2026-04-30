
-- 1. Patch set_company_integration_secret so it can never return NULL on success.
CREATE OR REPLACE FUNCTION public.set_company_integration_secret(p_integration_id text, p_plaintext text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'vault'
AS $function$
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
      v_secret_id := null; -- fall through to create a new vault secret
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
$function$;

-- 2. One-time data fix: re-link the HubSpot row to its existing vault secret.
update public.company_integrations
set encrypted_api_key = (
  select id::text
  from vault.secrets
  where name like 'company_integration:hubspot:%'
  order by updated_at desc
  limit 1
)
where integration_id = 'hubspot'
  and (encrypted_api_key is null or encrypted_api_key = '');

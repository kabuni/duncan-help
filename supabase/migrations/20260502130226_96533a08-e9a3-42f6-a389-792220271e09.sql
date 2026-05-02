-- Recreate view with security_invoker so it doesn't bypass RLS
DROP VIEW IF EXISTS public.company_integrations_status;

-- Use a SECURITY DEFINER function instead so authenticated users can read non-sensitive
-- status fields without exposing the encrypted_api_key column.
CREATE OR REPLACE FUNCTION public.get_company_integrations_status()
RETURNS TABLE (
  id uuid,
  integration_id text,
  status text,
  last_sync timestamptz,
  documents_ingested integer,
  updated_at timestamptz,
  created_at timestamptz,
  updated_by uuid
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    ci.id,
    ci.integration_id,
    ci.status,
    ci.last_sync,
    ci.documents_ingested,
    ci.updated_at,
    ci.created_at,
    ci.updated_by
  FROM public.company_integrations ci;
$$;

REVOKE ALL ON FUNCTION public.get_company_integrations_status() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_company_integrations_status() TO authenticated;
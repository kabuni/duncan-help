CREATE OR REPLACE FUNCTION public.get_company_integrations_status()
RETURNS TABLE(
  id uuid,
  integration_id text,
  status text,
  last_sync timestamp with time zone,
  documents_ingested integer,
  updated_at timestamp with time zone,
  created_at timestamp with time zone,
  updated_by uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'moderator') THEN
    RETURN QUERY
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
    RETURN;
  END IF;

  IF public.has_role(auth.uid(), 'recruitment_admin') THEN
    RETURN QUERY
    SELECT
      ci.id,
      ci.integration_id,
      ci.status,
      ci.last_sync,
      ci.documents_ingested,
      ci.updated_at,
      ci.created_at,
      ci.updated_by
    FROM public.company_integrations ci
    WHERE ci.integration_id = 'gmail';
    RETURN;
  END IF;

  RETURN;
END;
$$;
-- Restrict raw company_integrations to admins; expose safe status view to all authenticated users.

DROP POLICY IF EXISTS "Authenticated users can view company integrations" ON public.company_integrations;

-- Admin-only read on the raw table (secret refs live here)
CREATE POLICY "Admins can view company integrations"
ON public.company_integrations
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Safe view exposing only non-sensitive status fields for all authenticated users
CREATE OR REPLACE VIEW public.company_integrations_status
WITH (security_invoker = false) AS
SELECT
  id,
  integration_id,
  status,
  last_sync,
  documents_ingested,
  updated_at,
  created_at,
  updated_by
FROM public.company_integrations;

GRANT SELECT ON public.company_integrations_status TO authenticated;
REVOKE ALL ON public.company_integrations_status FROM anon;
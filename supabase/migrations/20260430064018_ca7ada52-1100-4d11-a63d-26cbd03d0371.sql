-- Restrict company_integrations SELECT to authenticated users only.
-- Removes public/anon read access to API tokens stored in this table.

DROP POLICY IF EXISTS "Everyone can view company integrations"
  ON public.company_integrations;

CREATE POLICY "Authenticated users can view company integrations"
  ON public.company_integrations
  FOR SELECT
  TO authenticated
  USING (true);

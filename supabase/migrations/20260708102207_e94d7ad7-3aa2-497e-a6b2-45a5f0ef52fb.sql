
CREATE POLICY "Authenticated can view work items"
  ON public.azure_work_items
  FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL);

GRANT SELECT ON public.azure_work_items TO authenticated;

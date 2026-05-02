
DROP POLICY IF EXISTS "Admins can manage suppliers" ON public.suppliers;
DROP POLICY IF EXISTS "Admins can manage supplier_contacts" ON public.supplier_contacts;
DROP POLICY IF EXISTS "Admins can manage supplier_workstreams" ON public.supplier_workstreams;

CREATE POLICY "Authenticated can manage suppliers"
  ON public.suppliers FOR ALL
  TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated can manage supplier_contacts"
  ON public.supplier_contacts FOR ALL
  TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated can manage supplier_workstreams"
  ON public.supplier_workstreams FOR ALL
  TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

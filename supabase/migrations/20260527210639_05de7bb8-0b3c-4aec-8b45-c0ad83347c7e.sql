
-- Restore broader read access on approvals to all authenticated users (pre-lockdown behavior).
DROP POLICY IF EXISTS approvals_involved_only ON public.approvals;
CREATE POLICY "Authenticated can view approvals"
  ON public.approvals FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL);

-- Restore broader access on candidates to all authenticated users (pre-lockdown behavior).
DROP POLICY IF EXISTS candidates_hr_admin_only ON public.candidates;
DROP POLICY IF EXISTS "Admins can manage candidates" ON public.candidates;
CREATE POLICY "Authenticated can view candidates"
  ON public.candidates FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated can insert candidates"
  ON public.candidates FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated can update candidates"
  ON public.candidates FOR UPDATE
  TO authenticated
  USING (auth.uid() IS NOT NULL);
CREATE POLICY "Admins can delete candidates"
  ON public.candidates FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

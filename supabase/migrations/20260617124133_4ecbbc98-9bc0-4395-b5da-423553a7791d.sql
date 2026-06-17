
-- Demote Arzoo from global admin
DELETE FROM public.user_roles
WHERE user_id = '73dc6ae9-36a9-4085-8634-0ea2b31817ab'
  AND role = 'admin';

-- Grant recruitment-scoped admin
INSERT INTO public.user_roles (user_id, role)
VALUES ('73dc6ae9-36a9-4085-8634-0ea2b31817ab', 'recruitment_admin')
ON CONFLICT (user_id, role) DO NOTHING;

-- Allow recruitment_admin to manage job_roles
DROP POLICY IF EXISTS "Admins can manage job roles" ON public.job_roles;
CREATE POLICY "Admins can manage job roles"
  ON public.job_roles
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'recruitment_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'recruitment_admin'));

-- Allow recruitment_admin to delete candidates
DROP POLICY IF EXISTS "Admins can delete candidates" ON public.candidates;
CREATE POLICY "Admins can delete candidates"
  ON public.candidates
  FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'recruitment_admin'));

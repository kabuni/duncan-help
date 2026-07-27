CREATE TABLE IF NOT EXISTS public.plan90_editors (
  user_id uuid PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);

GRANT SELECT ON public.plan90_editors TO authenticated;
GRANT ALL ON public.plan90_editors TO service_role;

ALTER TABLE public.plan90_editors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "plan90_editors read" ON public.plan90_editors FOR SELECT TO authenticated USING (true);
CREATE POLICY "plan90_editors admin manage" ON public.plan90_editors FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.can_edit_plan90(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _user_id IS NOT NULL AND (
    public.has_role(_user_id, 'admin')
    OR EXISTS (SELECT 1 FROM public.plan90_editors e WHERE e.user_id = _user_id)
  )
$$;

INSERT INTO public.plan90_editors (user_id) VALUES ('73dc6ae9-36a9-4085-8634-0ea2b31817ab')
ON CONFLICT (user_id) DO NOTHING;

DROP POLICY "plan90_ws admin insert" ON public.plan90_workstreams;
DROP POLICY "plan90_ws admin update" ON public.plan90_workstreams;
DROP POLICY "plan90_ws admin delete" ON public.plan90_workstreams;
CREATE POLICY "plan90_ws editor insert" ON public.plan90_workstreams FOR INSERT TO authenticated WITH CHECK (public.can_edit_plan90(auth.uid()));
CREATE POLICY "plan90_ws editor update" ON public.plan90_workstreams FOR UPDATE TO authenticated USING (public.can_edit_plan90(auth.uid())) WITH CHECK (public.can_edit_plan90(auth.uid()));
CREATE POLICY "plan90_ws editor delete" ON public.plan90_workstreams FOR DELETE TO authenticated USING (public.can_edit_plan90(auth.uid()));

DROP POLICY "plan90_d admin insert" ON public.plan90_deliverables;
DROP POLICY "plan90_d admin update" ON public.plan90_deliverables;
DROP POLICY "plan90_d admin delete" ON public.plan90_deliverables;
CREATE POLICY "plan90_d editor insert" ON public.plan90_deliverables FOR INSERT TO authenticated WITH CHECK (public.can_edit_plan90(auth.uid()));
CREATE POLICY "plan90_d editor update" ON public.plan90_deliverables FOR UPDATE TO authenticated USING (public.can_edit_plan90(auth.uid())) WITH CHECK (public.can_edit_plan90(auth.uid()));
CREATE POLICY "plan90_d editor delete" ON public.plan90_deliverables FOR DELETE TO authenticated USING (public.can_edit_plan90(auth.uid()));

DROP POLICY "plan90_att admin insert" ON public.plan90_attachments;
DROP POLICY "plan90_att admin delete" ON public.plan90_attachments;
CREATE POLICY "plan90_att editor insert" ON public.plan90_attachments FOR INSERT TO authenticated WITH CHECK (public.can_edit_plan90(auth.uid()));
CREATE POLICY "plan90_att editor delete" ON public.plan90_attachments FOR DELETE TO authenticated USING (public.can_edit_plan90(auth.uid()));
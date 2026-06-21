
-- 1. Extend candidates with hire metadata
ALTER TABLE public.candidates
  ADD COLUMN IF NOT EXISTS hired_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS start_date DATE,
  ADD COLUMN IF NOT EXISTS hiring_manager_id UUID,
  ADD COLUMN IF NOT EXISTS employment_type TEXT,
  ADD COLUMN IF NOT EXISTS work_location TEXT,
  ADD COLUMN IF NOT EXISTS preferred_name TEXT,
  ADD COLUMN IF NOT EXISTS onboarding_card_id UUID;

-- 2. Onboarding runs
CREATE TABLE IF NOT EXISTS public.onboarding_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id UUID NOT NULL REFERENCES public.candidates(id) ON DELETE CASCADE,
  card_id UUID,
  status TEXT NOT NULL DEFAULT 'pending',
  stages JSONB NOT NULL DEFAULT '{}'::jsonb,
  plan_30_60_90 JSONB,
  error TEXT,
  triggered_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (candidate_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.onboarding_runs TO authenticated;
GRANT ALL ON public.onboarding_runs TO service_role;

ALTER TABLE public.onboarding_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view onboarding runs"
ON public.onboarding_runs FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Admins can manage onboarding runs"
ON public.onboarding_runs FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'recruitment_admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'recruitment_admin'));

CREATE TRIGGER update_onboarding_runs_updated_at
BEFORE UPDATE ON public.onboarding_runs
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. Role Access Matrix defaults
CREATE TABLE IF NOT EXISTS public.role_access_defaults (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  department TEXT NOT NULL,
  role_title TEXT,
  tools JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.role_access_defaults TO authenticated;
GRANT ALL ON public.role_access_defaults TO service_role;

ALTER TABLE public.role_access_defaults ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view role access defaults"
ON public.role_access_defaults FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Admins can manage role access defaults"
ON public.role_access_defaults FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_role_access_defaults_updated_at
BEFORE UPDATE ON public.role_access_defaults
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Seed sensible defaults
INSERT INTO public.role_access_defaults (department, role_title, tools, notes) VALUES
  ('Engineering', NULL, '["GitHub","Azure DevOps","Linear","Notion","Slack","Google Workspace","1Password"]'::jsonb, 'Standard engineering stack'),
  ('Sales', NULL, '["HubSpot","Gong","Slack","Google Workspace","LinkedIn Sales Navigator","1Password"]'::jsonb, 'Sales rep defaults'),
  ('Operations', NULL, '["Basecamp","Google Drive shared folders","Slack","Google Workspace","Finance system (read)","1Password"]'::jsonb, 'Ops defaults'),
  ('Marketing', NULL, '["Google Analytics","HubSpot","Figma","Slack","Google Workspace","1Password"]'::jsonb, 'Marketing defaults'),
  ('Product', NULL, '["Linear","Figma","Notion","Slack","Google Workspace","Amplitude","1Password"]'::jsonb, 'Product defaults'),
  ('People', NULL, '["BambooHR","Slack","Google Workspace","Greenhouse","1Password"]'::jsonb, 'People/HR defaults')
ON CONFLICT DO NOTHING;

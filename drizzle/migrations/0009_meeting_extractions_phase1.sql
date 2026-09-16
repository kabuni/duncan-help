-- Phase 1: read-only meeting extraction staging. Additive only.

CREATE TABLE public.meeting_extractions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id uuid NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('create_task','update_due_date','update_owner','complete_task','blocked','decision')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','dismissed','auto_applied','undone')),
  confidence text NOT NULL CHECK (confidence IN ('high','medium','low')),
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  card_id uuid REFERENCES public.workstream_cards(id) ON DELETE SET NULL,
  task_id uuid REFERENCES public.workstream_tasks(id) ON DELETE SET NULL,
  proposed jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_quote text,
  reasoning text,
  resolved_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  applied_task_id uuid REFERENCES public.workstream_tasks(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, UPDATE ON public.meeting_extractions TO authenticated;
GRANT ALL ON public.meeting_extractions TO service_role;
ALTER TABLE public.meeting_extractions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Readable by project members or admins"
ON public.meeting_extractions FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR (project_id IS NOT NULL AND public.can_access_project(project_id, auth.uid()))
);

CREATE POLICY "Resolvable by project members or admins"
ON public.meeting_extractions FOR UPDATE TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR (project_id IS NOT NULL AND public.can_access_project(project_id, auth.uid()))
)
WITH CHECK (
  public.has_role(auth.uid(), 'admin')
  OR (project_id IS NOT NULL AND public.can_access_project(project_id, auth.uid()))
);

-- Deduplication: the same line from the same meeting is never suggested twice.
CREATE UNIQUE INDEX meeting_extractions_dedupe_idx
ON public.meeting_extractions (
  meeting_id,
  kind,
  COALESCE(task_id, '00000000-0000-0000-0000-000000000000'::uuid),
  md5(COALESCE(source_quote, ''))
);

CREATE INDEX meeting_extractions_project_status_idx
ON public.meeting_extractions (project_id, status);

-- create_task suggestions can never be inserted as anything but pending.
CREATE OR REPLACE FUNCTION public.enforce_meeting_extraction_rules()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.kind = 'create_task' AND NEW.status <> 'pending' THEN
    RAISE EXCEPTION 'create_task extractions must be created as pending';
  END IF;
  IF TG_OP = 'INSERT' AND NEW.status = 'auto_applied' THEN
    RAISE EXCEPTION 'extractions cannot be inserted as auto_applied';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER meeting_extractions_rules
BEFORE INSERT ON public.meeting_extractions
FOR EACH ROW EXECUTE FUNCTION public.enforce_meeting_extraction_rules();

-- Meeting -> Project links (meaning-level match required; written by backend)
CREATE TABLE public.meeting_project_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id uuid NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  card_id uuid REFERENCES public.workstream_cards(id) ON DELETE SET NULL,
  confidence text NOT NULL CHECK (confidence IN ('high','medium','low')),
  reasoning text,
  link_source text NOT NULL DEFAULT 'duncan' CHECK (link_source IN ('duncan','manual')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (meeting_id, project_id)
);

GRANT SELECT ON public.meeting_project_links TO authenticated;
GRANT ALL ON public.meeting_project_links TO service_role;
ALTER TABLE public.meeting_project_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Readable by project members or admins"
ON public.meeting_project_links FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR public.can_access_project(project_id, auth.uid())
);

-- Meeting source on the existing task table (no second task system)
ALTER TABLE public.workstream_tasks
  ADD COLUMN source_meeting_id uuid REFERENCES public.meetings(id) ON DELETE SET NULL,
  ADD COLUMN source_type text NOT NULL DEFAULT 'manual'
    CHECK (source_type IN ('manual','meeting','chat'));
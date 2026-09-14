-- Project metadata for the collaborative project workspace
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'on_track',
  ADD COLUMN IF NOT EXISTS target_date date;

-- Project -> Workstream Card relationship (canonical cards stay in workstream_cards)
ALTER TABLE public.workstream_cards
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_workstream_cards_project_id ON public.workstream_cards(project_id);

-- Tasks become one underlying object: they may hang off a card, a project, or both
ALTER TABLE public.workstream_tasks
  ALTER COLUMN card_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_workstream_tasks_project_id ON public.workstream_tasks(project_id);

-- A task must be attached to something
ALTER TABLE public.workstream_tasks
  DROP CONSTRAINT IF EXISTS workstream_tasks_parent_scope_check;
ALTER TABLE public.workstream_tasks
  ADD CONSTRAINT workstream_tasks_parent_scope_check
  CHECK (card_id IS NOT NULL OR project_id IS NOT NULL);

-- Access to project-scoped tasks (card-scoped policies already exist)
DROP POLICY IF EXISTS "Project members can view project tasks" ON public.workstream_tasks;
CREATE POLICY "Project members can view project tasks"
ON public.workstream_tasks FOR SELECT TO authenticated
USING (project_id IS NOT NULL AND public.can_access_project(project_id, auth.uid()));

DROP POLICY IF EXISTS "Project members can create project tasks" ON public.workstream_tasks;
CREATE POLICY "Project members can create project tasks"
ON public.workstream_tasks FOR INSERT TO authenticated
WITH CHECK (project_id IS NOT NULL AND public.can_access_project(project_id, auth.uid()));

DROP POLICY IF EXISTS "Project members can update project tasks" ON public.workstream_tasks;
CREATE POLICY "Project members can update project tasks"
ON public.workstream_tasks FOR UPDATE TO authenticated
USING (project_id IS NOT NULL AND public.can_access_project(project_id, auth.uid()))
WITH CHECK (project_id IS NOT NULL AND public.can_access_project(project_id, auth.uid()));

DROP POLICY IF EXISTS "Project members can delete project tasks" ON public.workstream_tasks;
CREATE POLICY "Project members can delete project tasks"
ON public.workstream_tasks FOR DELETE TO authenticated
USING (project_id IS NOT NULL AND public.can_access_project(project_id, auth.uid()));
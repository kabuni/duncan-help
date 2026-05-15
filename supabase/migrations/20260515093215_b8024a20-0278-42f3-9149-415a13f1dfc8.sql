
CREATE TABLE public.project_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  created_by uuid NOT NULL,
  title text NOT NULL DEFAULT 'Untitled note',
  content text NOT NULL DEFAULT '',
  pinned boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_project_notes_project ON public.project_notes(project_id, updated_at DESC);

ALTER TABLE public.project_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Project collaborators can view notes"
ON public.project_notes FOR SELECT TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_notes.project_id AND p.user_id = auth.uid())
  OR EXISTS (SELECT 1 FROM public.project_members pm WHERE pm.project_id = project_notes.project_id AND pm.user_id = auth.uid())
);

CREATE POLICY "Project collaborators can insert notes"
ON public.project_notes FOR INSERT TO authenticated
WITH CHECK (
  created_by = auth.uid() AND (
    EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_notes.project_id AND p.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.project_members pm WHERE pm.project_id = project_notes.project_id AND pm.user_id = auth.uid())
  )
);

CREATE POLICY "Project collaborators can update notes"
ON public.project_notes FOR UPDATE TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_notes.project_id AND p.user_id = auth.uid())
  OR EXISTS (SELECT 1 FROM public.project_members pm WHERE pm.project_id = project_notes.project_id AND pm.user_id = auth.uid())
);

CREATE POLICY "Owner or author can delete notes"
ON public.project_notes FOR DELETE TO authenticated
USING (
  created_by = auth.uid()
  OR EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_notes.project_id AND p.user_id = auth.uid())
);

CREATE TRIGGER set_project_notes_updated_at
BEFORE UPDATE ON public.project_notes
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

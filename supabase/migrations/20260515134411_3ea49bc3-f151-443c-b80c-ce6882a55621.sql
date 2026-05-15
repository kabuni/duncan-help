
-- Folders for project notes (supports nesting via parent_folder_id)
CREATE TABLE public.project_note_folders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  parent_folder_id UUID REFERENCES public.project_note_folders(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_pnf_project ON public.project_note_folders(project_id);
CREATE INDEX idx_pnf_parent ON public.project_note_folders(parent_folder_id);

ALTER TABLE public.project_note_folders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Project collaborators can view folders"
ON public.project_note_folders FOR SELECT
USING (
  EXISTS (SELECT 1 FROM projects p WHERE p.id = project_note_folders.project_id AND p.user_id = auth.uid())
  OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = project_note_folders.project_id AND pm.user_id = auth.uid())
);

CREATE POLICY "Project collaborators can insert folders"
ON public.project_note_folders FOR INSERT
WITH CHECK (
  created_by = auth.uid() AND (
    EXISTS (SELECT 1 FROM projects p WHERE p.id = project_note_folders.project_id AND p.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = project_note_folders.project_id AND pm.user_id = auth.uid())
  )
);

CREATE POLICY "Project collaborators can update folders"
ON public.project_note_folders FOR UPDATE
USING (
  EXISTS (SELECT 1 FROM projects p WHERE p.id = project_note_folders.project_id AND p.user_id = auth.uid())
  OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = project_note_folders.project_id AND pm.user_id = auth.uid())
);

CREATE POLICY "Owner or author can delete folders"
ON public.project_note_folders FOR DELETE
USING (
  created_by = auth.uid()
  OR EXISTS (SELECT 1 FROM projects p WHERE p.id = project_note_folders.project_id AND p.user_id = auth.uid())
);

CREATE TRIGGER update_project_note_folders_updated_at
BEFORE UPDATE ON public.project_note_folders
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Add folder_id to notes (null = root)
ALTER TABLE public.project_notes
  ADD COLUMN folder_id UUID REFERENCES public.project_note_folders(id) ON DELETE SET NULL;

CREATE INDEX idx_project_notes_folder ON public.project_notes(folder_id);

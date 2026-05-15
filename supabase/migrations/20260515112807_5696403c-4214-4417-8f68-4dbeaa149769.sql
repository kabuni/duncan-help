
-- Attachments table for project notes
CREATE TABLE public.project_note_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id UUID NOT NULL REFERENCES public.project_notes(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  uploaded_by UUID NOT NULL,
  storage_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT,
  size_bytes BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_pna_note ON public.project_note_attachments(note_id, created_at DESC);

ALTER TABLE public.project_note_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View note attachments if project access" ON public.project_note_attachments
FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid())
  OR EXISTS (SELECT 1 FROM public.project_members pm WHERE pm.project_id = project_note_attachments.project_id AND pm.user_id = auth.uid())
);

CREATE POLICY "Insert note attachments if project access" ON public.project_note_attachments
FOR INSERT TO authenticated WITH CHECK (
  uploaded_by = auth.uid() AND (
    EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.project_members pm WHERE pm.project_id = project_note_attachments.project_id AND pm.user_id = auth.uid())
  )
);

CREATE POLICY "Delete own note attachments or project owner" ON public.project_note_attachments
FOR DELETE TO authenticated USING (
  uploaded_by = auth.uid()
  OR EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid())
);

-- Storage bucket
INSERT INTO storage.buckets (id, name, public) VALUES ('project-note-attachments', 'project-note-attachments', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Note attach: read own" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'project-note-attachments' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Note attach: upload own" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'project-note-attachments' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Note attach: delete own" ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'project-note-attachments' AND auth.uid()::text = (storage.foldername(name))[1]);


-- Storage bucket for workstream task attachments
INSERT INTO storage.buckets (id, name, public)
VALUES ('workstream-task-attachments', 'workstream-task-attachments', false)
ON CONFLICT (id) DO NOTHING;

-- Attachments table
CREATE TABLE IF NOT EXISTS public.workstream_task_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.workstream_tasks(id) ON DELETE CASCADE,
  uploaded_by uuid NOT NULL,
  file_name text NOT NULL,
  storage_path text NOT NULL,
  mime_type text,
  size_bytes bigint,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wta_task ON public.workstream_task_attachments(task_id);

ALTER TABLE public.workstream_task_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view task attachments"
ON public.workstream_task_attachments FOR SELECT TO authenticated
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated can insert task attachments"
ON public.workstream_task_attachments FOR INSERT TO authenticated
WITH CHECK (auth.uid() = uploaded_by);

CREATE POLICY "Uploader or admin can delete task attachments"
ON public.workstream_task_attachments FOR DELETE TO authenticated
USING (auth.uid() = uploaded_by OR has_role(auth.uid(), 'admin'::app_role));

-- Storage policies (bucket: workstream-task-attachments)
CREATE POLICY "Auth can view workstream task attachments"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'workstream-task-attachments');

CREATE POLICY "Auth can upload workstream task attachments"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'workstream-task-attachments');

CREATE POLICY "Auth can delete workstream task attachments"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'workstream-task-attachments');

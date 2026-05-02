-- Storage bucket for key event attachments
INSERT INTO storage.buckets (id, name, public)
VALUES ('key-event-attachments', 'key-event-attachments', false)
ON CONFLICT (id) DO NOTHING;

-- Attachments table
CREATE TABLE IF NOT EXISTS public.key_event_attachments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id UUID NOT NULL REFERENCES public.key_events(id) ON DELETE CASCADE,
  uploaded_by UUID NOT NULL,
  file_name TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  mime_type TEXT,
  size_bytes BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_key_event_attachments_event ON public.key_event_attachments(event_id);

ALTER TABLE public.key_event_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view attachments"
  ON public.key_event_attachments FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Authenticated can insert attachments"
  ON public.key_event_attachments FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = uploaded_by);

CREATE POLICY "Uploader or admin can delete attachments"
  ON public.key_event_attachments FOR DELETE
  TO authenticated USING (
    auth.uid() = uploaded_by OR public.has_role(auth.uid(), 'admin')
  );

-- Storage policies
CREATE POLICY "Authenticated can read key event attachments"
  ON storage.objects FOR SELECT
  TO authenticated USING (bucket_id = 'key-event-attachments');

CREATE POLICY "Authenticated can upload key event attachments"
  ON storage.objects FOR INSERT
  TO authenticated WITH CHECK (bucket_id = 'key-event-attachments');

CREATE POLICY "Authenticated can delete key event attachments"
  ON storage.objects FOR DELETE
  TO authenticated USING (bucket_id = 'key-event-attachments');

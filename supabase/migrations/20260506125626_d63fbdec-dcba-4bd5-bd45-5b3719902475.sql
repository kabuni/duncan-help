-- Storage bucket (private)
INSERT INTO storage.buckets (id, name, public)
VALUES ('feature-request-attachments', 'feature-request-attachments', false)
ON CONFLICT (id) DO NOTHING;

-- Attachments table
CREATE TABLE public.feature_request_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feature_request_id UUID NOT NULL REFERENCES public.feature_requests(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT,
  size_bytes BIGINT,
  uploaded_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_fra_feature_request_id ON public.feature_request_attachments(feature_request_id);
CREATE INDEX idx_fra_uploaded_by ON public.feature_request_attachments(uploaded_by);

ALTER TABLE public.feature_request_attachments ENABLE ROW LEVEL SECURITY;

-- Users can view attachments on their own requests; admins all
CREATE POLICY "View own or admin attachments"
ON public.feature_request_attachments
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR EXISTS (
    SELECT 1 FROM public.feature_requests fr
    WHERE fr.id = feature_request_id AND fr.user_id = auth.uid()
  )
);

-- Users can insert attachments only on their own feature requests
CREATE POLICY "Insert attachments on own requests"
ON public.feature_request_attachments
FOR INSERT
TO authenticated
WITH CHECK (
  uploaded_by = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.feature_requests fr
    WHERE fr.id = feature_request_id AND fr.user_id = auth.uid()
  )
);

-- Users can delete their own; admins all
CREATE POLICY "Delete own or admin attachments"
ON public.feature_request_attachments
FOR DELETE
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR uploaded_by = auth.uid()
);

-- Storage policies (path = <user_id>/<request_id>/<filename>)
CREATE POLICY "FRA: users read own files"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'feature-request-attachments'
  AND (
    public.has_role(auth.uid(), 'admin')
    OR auth.uid()::text = (storage.foldername(name))[1]
  )
);

CREATE POLICY "FRA: users upload own files"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'feature-request-attachments'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "FRA: users delete own files"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'feature-request-attachments'
  AND (
    public.has_role(auth.uid(), 'admin')
    OR auth.uid()::text = (storage.foldername(name))[1]
  )
);

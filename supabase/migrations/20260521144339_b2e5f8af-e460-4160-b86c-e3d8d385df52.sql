
-- Private storage bucket for staging PDFs that Duncan should send for e-signature.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('docusign-staging', 'docusign-staging', false, 20971520, ARRAY['application/pdf'])
ON CONFLICT (id) DO NOTHING;

-- Users can upload/read/delete their own staged files only. Path prefix = user id.
CREATE POLICY "docusign_staging_user_select"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'docusign-staging' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "docusign_staging_user_insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'docusign-staging' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "docusign_staging_user_delete"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'docusign-staging' AND (storage.foldername(name))[1] = auth.uid()::text);

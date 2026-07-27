
-- Files are stored under `${project_id}/${user_id}/${timestamp}-${name}`
CREATE POLICY "collab read project chat attachments"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'project-chat-attachments'
  AND public.can_access_project((storage.foldername(name))[1]::uuid, auth.uid())
);

CREATE POLICY "collab upload project chat attachments"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'project-chat-attachments'
  AND public.can_access_project((storage.foldername(name))[1]::uuid, auth.uid())
  AND (storage.foldername(name))[2] = auth.uid()::text
);

CREATE POLICY "author delete project chat attachments"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'project-chat-attachments'
  AND (
    (storage.foldername(name))[2] = auth.uid()::text
    OR public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = (storage.foldername(name))[1]::uuid
        AND p.user_id = auth.uid()
    )
  )
);

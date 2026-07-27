DROP POLICY "plan90 storage admin insert" ON storage.objects;
DROP POLICY "plan90 storage admin delete" ON storage.objects;
CREATE POLICY "plan90 storage editor insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'plan90-attachments' AND public.can_edit_plan90(auth.uid()));
CREATE POLICY "plan90 storage editor delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'plan90-attachments' AND public.can_edit_plan90(auth.uid()));
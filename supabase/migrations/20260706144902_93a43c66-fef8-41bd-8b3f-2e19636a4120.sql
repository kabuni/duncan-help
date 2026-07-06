
-- 1. Extend workstream_task_attachments to allow referencing files in other buckets
ALTER TABLE public.workstream_task_attachments
  ADD COLUMN IF NOT EXISTS source_bucket text NOT NULL DEFAULT 'workstream-task-attachments';

-- 2. Add offer letter path on candidates
ALTER TABLE public.candidates
  ADD COLUMN IF NOT EXISTS offer_letter_storage_path text;

-- 3. RLS policies for offer-letters storage bucket
CREATE POLICY "Authenticated can read offer letters"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'offer-letters');

CREATE POLICY "Authenticated can upload offer letters"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'offer-letters');

CREATE POLICY "Authenticated can update offer letters"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'offer-letters');

CREATE POLICY "Authenticated can delete offer letters"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'offer-letters');

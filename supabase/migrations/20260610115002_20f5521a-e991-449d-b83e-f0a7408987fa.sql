
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS page_count integer,
  ADD COLUMN IF NOT EXISTS chars_extracted integer,
  ADD COLUMN IF NOT EXISTS chunks_generated integer,
  ADD COLUMN IF NOT EXISTS processing_started_at timestamptz;

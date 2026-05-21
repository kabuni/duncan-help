ALTER TABLE public.exec_summary_runs ADD COLUMN IF NOT EXISTS content_hash TEXT;
CREATE INDEX IF NOT EXISTS exec_summary_runs_folder_hash_idx ON public.exec_summary_runs (folder_id, content_hash);
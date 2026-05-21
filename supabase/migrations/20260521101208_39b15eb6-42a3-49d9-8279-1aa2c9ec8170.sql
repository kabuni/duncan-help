
CREATE TABLE IF NOT EXISTS public.exec_summary_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'running',
  trigger_source TEXT NOT NULL DEFAULT 'cron',
  triggered_by UUID,
  folder_id TEXT,
  folder_name TEXT,
  files_processed JSONB DEFAULT '[]'::jsonb,
  file_count INTEGER DEFAULT 0,
  failed_files JSONB DEFAULT '[]'::jsonb,
  summary_chars INTEGER,
  blob_path TEXT,
  file_name TEXT,
  download_token TEXT,
  recipient TEXT,
  email_message_id TEXT,
  error TEXT,
  error_details JSONB,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS exec_summary_runs_started_at_idx ON public.exec_summary_runs (started_at DESC);
CREATE INDEX IF NOT EXISTS exec_summary_runs_status_idx ON public.exec_summary_runs (status);

ALTER TABLE public.exec_summary_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view exec summary runs" ON public.exec_summary_runs;
CREATE POLICY "Admins can view exec summary runs"
  ON public.exec_summary_runs FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_exec_summary_runs_updated_at
  BEFORE UPDATE ON public.exec_summary_runs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

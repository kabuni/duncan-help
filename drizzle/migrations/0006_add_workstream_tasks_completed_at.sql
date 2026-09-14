ALTER TABLE public.workstream_tasks ADD COLUMN IF NOT EXISTS completed_at timestamptz;
COMMENT ON COLUMN public.workstream_tasks.completed_at IS 'When the task was marked completed';
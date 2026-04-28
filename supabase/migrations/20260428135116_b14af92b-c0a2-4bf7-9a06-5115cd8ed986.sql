ALTER TABLE public.workstream_tasks
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'green';

ALTER TABLE public.workstream_tasks
  DROP CONSTRAINT IF EXISTS workstream_tasks_status_check;

ALTER TABLE public.workstream_tasks
  ADD CONSTRAINT workstream_tasks_status_check
  CHECK (status IN ('red','amber','green','done'));

-- Backfill: completed tasks should reflect 'done'
UPDATE public.workstream_tasks SET status = 'done' WHERE completed = true AND status <> 'done';
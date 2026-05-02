ALTER TABLE public.workstream_tasks DROP CONSTRAINT IF EXISTS workstream_tasks_status_check;
ALTER TABLE public.workstream_tasks ADD CONSTRAINT workstream_tasks_status_check CHECK (status = ANY (ARRAY['not_started'::text, 'red'::text, 'amber'::text, 'green'::text, 'done'::text]));
ALTER TABLE public.workstream_tasks ALTER COLUMN status SET DEFAULT 'not_started'::text;
ALTER TABLE public.workstream_cards ALTER COLUMN status SET DEFAULT 'not_started'::text;
ALTER TABLE public.key_events
  ADD COLUMN IF NOT EXISTS collaborators jsonb NOT NULL DEFAULT '[]'::jsonb;
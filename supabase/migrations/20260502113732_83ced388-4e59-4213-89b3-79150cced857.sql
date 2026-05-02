ALTER TABLE public.key_events
  ADD COLUMN IF NOT EXISTS start_tz text NOT NULL DEFAULT 'Europe/London';
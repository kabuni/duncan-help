ALTER TABLE public.event_links
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';

COMMENT ON COLUMN public.event_links.status IS 'Lifecycle of the logical (linked) event: active | cancelled.';
-- Destination decision / linked-event infrastructure
ALTER TABLE public.key_events
  ADD COLUMN IF NOT EXISTS event_type TEXT,
  ADD COLUMN IF NOT EXISTS link_group TEXT;

CREATE TABLE IF NOT EXISTS public.event_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  link_group TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  source_of_truth TEXT NOT NULL CHECK (source_of_truth IN ('PLANNER','GOOGLE_CALENDAR')),
  destinations TEXT[] NOT NULL DEFAULT '{}',
  planner_event_id UUID REFERENCES public.key_events(id) ON DELETE SET NULL,
  google_event_id TEXT,
  google_calendar_id TEXT,
  created_by UUID,
  last_sync_origin TEXT,
  last_sync_hash TEXT,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS event_links_planner_idx ON public.event_links(planner_event_id);
CREATE INDEX IF NOT EXISTS event_links_google_idx ON public.event_links(google_event_id);
CREATE INDEX IF NOT EXISTS key_events_link_group_idx ON public.key_events(link_group);

GRANT SELECT ON public.event_links TO authenticated;
GRANT ALL ON public.event_links TO service_role;

ALTER TABLE public.event_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can view event links" ON public.event_links;
CREATE POLICY "Authenticated can view event links"
ON public.event_links FOR SELECT TO authenticated USING (true);

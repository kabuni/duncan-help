
-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ============================================================
-- duncan_calendar_tokens: single shared OAuth connection
-- ============================================================
CREATE TABLE public.duncan_calendar_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  access_token text NOT NULL,
  refresh_token text NOT NULL,
  token_expiry timestamptz NOT NULL,
  google_account_email text,
  calendar_id text,
  calendar_name text DEFAULT 'Duncan | Key Events',
  connected_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.duncan_calendar_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage duncan calendar tokens"
  ON public.duncan_calendar_tokens
  FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Allow authenticated users to see *connection status* via a safe view (not raw tokens).
CREATE OR REPLACE VIEW public.duncan_calendar_status AS
SELECT
  (id IS NOT NULL) AS connected,
  google_account_email,
  calendar_id,
  calendar_name,
  updated_at AS last_updated
FROM public.duncan_calendar_tokens
LIMIT 1;

GRANT SELECT ON public.duncan_calendar_status TO authenticated;

CREATE TRIGGER duncan_calendar_tokens_updated_at
  BEFORE UPDATE ON public.duncan_calendar_tokens
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- key_event_goals
-- ============================================================
CREATE TABLE public.key_event_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  target_date date,
  status text NOT NULL DEFAULT 'active', -- active | achieved | dropped
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.key_event_goals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view key event goals"
  ON public.key_event_goals FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins manage key event goals"
  ON public.key_event_goals FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER key_event_goals_updated_at
  BEFORE UPDATE ON public.key_event_goals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Seed the five starter goals
INSERT INTO public.key_event_goals (name, description, sort_order) VALUES
  ('June 7 launch',           'Kabuni public launch on June 7', 1),
  ('1M K10 registrations',    '1,000,000 Kabuni K10 registrations', 2),
  ('100k pre-orders',         '100,000 pre-orders secured', 3),
  ('Fundraising',             'Active fundraising round milestones', 4),
  ('Product delivery',        'Core product build & delivery milestones', 5);

-- ============================================================
-- key_events
-- ============================================================
CREATE TABLE public.key_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  google_event_id text NOT NULL UNIQUE,
  calendar_id text NOT NULL,

  title text NOT NULL,
  raw_description text,
  start_at timestamptz,
  end_at timestamptz,
  all_day boolean NOT NULL DEFAULT false,
  location text,
  html_link text,
  organizer_email text,
  attendees jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text, -- google: confirmed/tentative/cancelled

  -- parsed
  category text,
  event_name text,
  owner text,
  objective text,
  success_metric text,
  decision_needed text,
  linked_docs jsonb NOT NULL DEFAULT '[]'::jsonb,
  risks text,
  next_action text,

  -- derived
  missing_fields text[] NOT NULL DEFAULT '{}',
  is_complete boolean NOT NULL DEFAULT false,
  risk_level text NOT NULL DEFAULT 'green', -- green | amber | red
  risk_reason text,
  linked_goal_ids uuid[] NOT NULL DEFAULT '{}',
  classification_confidence numeric,
  last_classified_at timestamptz,

  deleted_in_google boolean NOT NULL DEFAULT false,
  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_key_events_start_at ON public.key_events (start_at);
CREATE INDEX idx_key_events_risk ON public.key_events (risk_level);
CREATE INDEX idx_key_events_category ON public.key_events (category);

ALTER TABLE public.key_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view key events"
  ON public.key_events FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins manage key events"
  ON public.key_events FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER key_events_updated_at
  BEFORE UPDATE ON public.key_events
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- key_event_sync_log
-- ============================================================
CREATE TABLE public.key_event_sync_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  events_seen int NOT NULL DEFAULT 0,
  events_upserted int NOT NULL DEFAULT 0,
  events_flagged int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'running', -- running | success | error
  error text
);

ALTER TABLE public.key_event_sync_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view key event sync log"
  ON public.key_event_sync_log FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins manage key event sync log"
  ON public.key_event_sync_log FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- ============================================================
-- Cron: sync every 15 minutes
-- ============================================================
SELECT cron.schedule(
  'duncan-calendar-sync-15m',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://rfwvemsjwytxxhwowpqh.supabase.co/functions/v1/duncan-calendar-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJmd3ZlbXNqd3l0eHhod293cHFoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA0NTc2NTcsImV4cCI6MjA4NjAzMzY1N30.in8xz4qXQCqM8rs0PXXrmMt3epmt8nNFUHVD3kWyYn4'
    ),
    body := jsonb_build_object('source', 'cron')
  );
  $$
);

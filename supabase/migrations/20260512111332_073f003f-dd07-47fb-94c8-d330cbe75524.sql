-- RSVP table
CREATE TABLE public.event_rsvps (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id UUID NOT NULL REFERENCES public.key_events(id) ON DELETE CASCADE,
  profile_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  email TEXT NOT NULL,
  display_name TEXT,
  status TEXT NOT NULL DEFAULT 'yes' CHECK (status IN ('yes','no','maybe')),
  source TEXT NOT NULL DEFAULT 'email',
  notes TEXT,
  gmail_message_id TEXT UNIQUE,
  responded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, email)
);

CREATE INDEX idx_event_rsvps_event ON public.event_rsvps(event_id);
CREATE INDEX idx_event_rsvps_profile ON public.event_rsvps(profile_id);

ALTER TABLE public.event_rsvps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view RSVPs"
ON public.event_rsvps FOR SELECT
TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert their own RSVP"
ON public.event_rsvps FOR INSERT
TO authenticated WITH CHECK (
  profile_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid())
);

CREATE POLICY "Authenticated users can update their own RSVP"
ON public.event_rsvps FOR UPDATE
TO authenticated USING (
  profile_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid())
);

CREATE TRIGGER update_event_rsvps_updated_at
BEFORE UPDATE ON public.event_rsvps
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Schedule the RSVP email processor (every 10 minutes)
SELECT cron.schedule(
  'process-rsvp-emails',
  '*/10 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://rfwvemsjwytxxhwowpqh.supabase.co/functions/v1/process-rsvp-emails',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
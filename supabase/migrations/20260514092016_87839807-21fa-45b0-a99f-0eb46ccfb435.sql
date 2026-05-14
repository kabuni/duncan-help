
ALTER TABLE public.event_rsvps
  ADD COLUMN IF NOT EXISTS gmail_thread_id TEXT,
  ADD COLUMN IF NOT EXISTS follow_up_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_inbound_message_id TEXT;

ALTER TABLE public.event_rsvps DROP CONSTRAINT IF EXISTS event_rsvps_gmail_message_id_key;

CREATE INDEX IF NOT EXISTS idx_event_rsvps_gmail_thread_id ON public.event_rsvps(gmail_thread_id);

CREATE TABLE IF NOT EXISTS public.event_rsvp_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gmail_message_id TEXT NOT NULL UNIQUE,
  gmail_thread_id TEXT,
  rsvp_id UUID REFERENCES public.event_rsvps(id) ON DELETE SET NULL,
  sender_email TEXT,
  subject TEXT,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  outcome TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_rsvp_messages_thread ON public.event_rsvp_messages(gmail_thread_id);

ALTER TABLE public.event_rsvp_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view rsvp messages" ON public.event_rsvp_messages;
CREATE POLICY "Admins can view rsvp messages"
  ON public.event_rsvp_messages
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

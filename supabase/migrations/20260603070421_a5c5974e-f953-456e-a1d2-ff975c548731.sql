CREATE TABLE public.meeting_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_name TEXT NOT NULL,
  sender_email TEXT NOT NULL,
  gmail_thread_id TEXT NOT NULL UNIQUE,
  gmail_message_id TEXT,
  original_email_subject TEXT,
  original_email_body TEXT NOT NULL,
  purpose TEXT,
  priority TEXT CHECK (priority IN ('P1','P2','P3','P4')),
  priority_reason TEXT,
  proposed_slot TIMESTAMPTZ,
  proposed_slot_end TIMESTAMPTZ,
  calendar_event_id TEXT,
  status TEXT NOT NULL DEFAULT 'awaiting_purpose'
    CHECK (status IN ('awaiting_purpose','pending_approval','confirmed','declined','rescheduled')),
  last_polled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_meeting_requests_status ON public.meeting_requests(status);
CREATE INDEX idx_meeting_requests_thread ON public.meeting_requests(gmail_thread_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.meeting_requests TO authenticated;
GRANT ALL ON public.meeting_requests TO service_role;

ALTER TABLE public.meeting_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read meeting requests"
  ON public.meeting_requests FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins update meeting requests"
  ON public.meeting_requests FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER meeting_requests_updated_at
  BEFORE UPDATE ON public.meeting_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TABLE public.event_attendees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_name text NOT NULL DEFAULT 'Kabuni Showcase - Mumbai (Jio World Center)',
  name text,
  email text,
  phone text,
  company text,
  role text,
  city text,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  upload_batch_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_attendees TO authenticated;
GRANT ALL ON public.event_attendees TO service_role;

ALTER TABLE public.event_attendees ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view event attendees"
  ON public.event_attendees FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can insert event attendees"
  ON public.event_attendees FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update event attendees"
  ON public.event_attendees FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete event attendees"
  ON public.event_attendees FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_event_attendees_event_name ON public.event_attendees(event_name);
CREATE INDEX idx_event_attendees_created_at ON public.event_attendees(created_at DESC);
CREATE INDEX idx_event_attendees_batch ON public.event_attendees(upload_batch_id);
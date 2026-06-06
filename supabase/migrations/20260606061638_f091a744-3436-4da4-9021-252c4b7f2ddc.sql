
CREATE TABLE public.school_registrations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  school_name TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT INSERT ON public.school_registrations TO anon;
GRANT INSERT, SELECT ON public.school_registrations TO authenticated;
GRANT ALL ON public.school_registrations TO service_role;

ALTER TABLE public.school_registrations ENABLE ROW LEVEL SECURITY;

-- Anyone (including unauthenticated) can submit a registration
CREATE POLICY "Anyone can submit a school registration"
  ON public.school_registrations FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- Only admins can view registrations
CREATE POLICY "Admins can view school registrations"
  ON public.school_registrations FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Only admins can delete registrations
CREATE POLICY "Admins can delete school registrations"
  ON public.school_registrations FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

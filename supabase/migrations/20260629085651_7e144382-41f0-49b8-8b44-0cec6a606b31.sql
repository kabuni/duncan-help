
CREATE TYPE public.school_tracker_status AS ENUM ('registered', 'confirmed', 'pending', 'declined');

CREATE TABLE public.school_tracker (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  region text NOT NULL,
  status public.school_tracker_status NOT NULL DEFAULT 'pending',
  progress_pct integer NOT NULL DEFAULT 0 CHECK (progress_pct >= 0 AND progress_pct <= 100),
  student_count integer NOT NULL DEFAULT 0 CHECK (student_count >= 0),
  target_flag boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.school_tracker TO authenticated;
GRANT ALL ON public.school_tracker TO service_role;

ALTER TABLE public.school_tracker ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view school tracker"
  ON public.school_tracker FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can manage school tracker"
  ON public.school_tracker FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER update_school_tracker_updated_at
  BEFORE UPDATE ON public.school_tracker
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.school_tracker (name, region, status, progress_pct, student_count) VALUES
  ('Greenfield Academy', 'London, UK', 'registered', 100, 420),
  ('Oakridge International', 'Manchester, UK', 'registered', 100, 560),
  ('St. Mary''s Grammar', 'Dublin, IE', 'registered', 100, 310),
  ('Riverside High', 'Toronto, CA', 'confirmed', 80, 640),
  ('Maple Leaf School', 'Vancouver, CA', 'confirmed', 75, 280),
  ('Lakeside Prep', 'Birmingham, UK', 'confirmed', 70, 390),
  ('Sunrise Public School', 'Mumbai, IN', 'pending', 40, 720),
  ('DPS Bangalore', 'Bangalore, IN', 'pending', 35, 980),
  ('Heritage School', 'Delhi, IN', 'pending', 25, 540),
  ('Bright Future Academy', 'Chennai, IN', 'pending', 20, 410),
  ('Westgate College', 'Leeds, UK', 'pending', 15, 350),
  ('Crestview Academy', 'Edinburgh, UK', 'declined', 0, 220),
  ('Pinewood School', 'Glasgow, UK', 'declined', 0, 180);


-- ============ Workstreams ============
CREATE TABLE public.plan90_workstreams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text,
  display_order int NOT NULL DEFAULT 0,
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.plan90_workstreams TO authenticated;
GRANT ALL ON public.plan90_workstreams TO service_role;
ALTER TABLE public.plan90_workstreams ENABLE ROW LEVEL SECURITY;
CREATE POLICY "plan90_ws read" ON public.plan90_workstreams FOR SELECT TO authenticated USING (true);
CREATE POLICY "plan90_ws admin insert" ON public.plan90_workstreams FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "plan90_ws admin update" ON public.plan90_workstreams FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "plan90_ws admin delete" ON public.plan90_workstreams FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER trg_plan90_ws_updated BEFORE UPDATE ON public.plan90_workstreams FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ Deliverables ============
CREATE TABLE public.plan90_deliverables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workstream_id uuid NOT NULL REFERENCES public.plan90_workstreams(id) ON DELETE CASCADE,
  title text NOT NULL,
  owner_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  owner_display_name text,
  due_date date,
  status text NOT NULL DEFAULT 'Not Started',
  priority text NOT NULL DEFAULT 'Medium',
  notes text,
  archived boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX plan90_deliverables_ws_title_uniq ON public.plan90_deliverables (workstream_id, lower(title));
CREATE INDEX plan90_deliverables_ws_idx ON public.plan90_deliverables (workstream_id);
CREATE INDEX plan90_deliverables_owner_idx ON public.plan90_deliverables (owner_user_id);
CREATE INDEX plan90_deliverables_due_idx ON public.plan90_deliverables (due_date);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.plan90_deliverables TO authenticated;
GRANT ALL ON public.plan90_deliverables TO service_role;
ALTER TABLE public.plan90_deliverables ENABLE ROW LEVEL SECURITY;
CREATE POLICY "plan90_d read" ON public.plan90_deliverables FOR SELECT TO authenticated USING (true);
CREATE POLICY "plan90_d admin insert" ON public.plan90_deliverables FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "plan90_d admin update" ON public.plan90_deliverables FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "plan90_d admin delete" ON public.plan90_deliverables FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER trg_plan90_d_updated BEFORE UPDATE ON public.plan90_deliverables FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ Attachments ============
CREATE TABLE public.plan90_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deliverable_id uuid NOT NULL REFERENCES public.plan90_deliverables(id) ON DELETE CASCADE,
  uploaded_by uuid REFERENCES auth.users(id),
  file_name text NOT NULL,
  storage_path text NOT NULL,
  mime_type text,
  size_bytes bigint,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX plan90_attachments_deliverable_idx ON public.plan90_attachments(deliverable_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.plan90_attachments TO authenticated;
GRANT ALL ON public.plan90_attachments TO service_role;
ALTER TABLE public.plan90_attachments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "plan90_att read" ON public.plan90_attachments FOR SELECT TO authenticated USING (true);
CREATE POLICY "plan90_att admin insert" ON public.plan90_attachments FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "plan90_att admin delete" ON public.plan90_attachments FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- ============ Storage policies (bucket created via tool separately) ============
CREATE POLICY "plan90 storage read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'plan90-attachments');
CREATE POLICY "plan90 storage admin insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'plan90-attachments' AND public.has_role(auth.uid(),'admin'));
CREATE POLICY "plan90 storage admin delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'plan90-attachments' AND public.has_role(auth.uid(),'admin'));

-- ============ Seed workstreams ============
INSERT INTO public.plan90_workstreams (name, display_order) VALUES
  ('Product & Tech', 10),
  ('Marketing & Creative', 20),
  ('Operations', 30),
  ('Culture', 40),
  ('Legal & Compliance', 50),
  ('Finance', 60),
  ('Key Metrics', 70),
  ('India', 80)
ON CONFLICT (name) DO NOTHING;

-- ============ Seed deliverables ============
WITH src(ws, title, owner_name, owner_uid, due, status, priority, notes) AS (VALUES
  ('Product & Tech','Delivery Plan that breaks down MVP requirments','Matt McCartney','6c5691fa-bb0b-4f39-a046-2207f875b3ad'::uuid,'2026-07-31'::date,'In Progress','Critical',NULL),
  ('Product & Tech','Manufacturing Plan Defined','Parmy Virk','81ecadbf-5b8c-4fa0-b8b0-b0dea2f54f0e'::uuid,'2026-08-31','Not Started','Critical',NULL),
  ('Product & Tech','Develop training model with clips','Simon Wood','e68a2e97-e700-4e52-8f83-fd3e9236724b'::uuid,'2026-09-30','In Progress','Critical','8000  a month to be uploaded'),
  ('Product & Tech','UI/UX Resource in place','Simon Wood','e68a2e97-e700-4e52-8f83-fd3e9236724b'::uuid,'2026-07-31','Not Started','High',NULL),
  ('Product & Tech','Industrial Designer in place','Simon Wood','e68a2e97-e700-4e52-8f83-fd3e9236724b'::uuid,'2026-07-31','Not Started','High',NULL),
  ('Product & Tech','Technology Assessment and recommendations- what systems are we using','Parmy Virk','81ecadbf-5b8c-4fa0-b8b0-b0dea2f54f0e'::uuid,'2026-07-31','Not Started','High',NULL),
  ('Marketing & Creative','Schools - Deliver branding package for schools & conferences','Tim Hunt','0dc76d15-cd2c-4588-b4e7-1b3ccda5942a'::uuid,'2026-07-31','Not Started','Medium',NULL),
  ('Marketing & Creative','Social Strategy - Cricket/ Brand & On the Sreets/BTS','Danielle Saunders',NULL,'2026-07-31','In Progress','High',NULL),
  ('Marketing & Creative','Commission Audience Research Qual & Quant','Tim Hunt','0dc76d15-cd2c-4588-b4e7-1b3ccda5942a'::uuid,'2026-07-31','In Progress','Medium',NULL),
  ('Marketing & Creative','Brand Book V2 Global/ India','Jonty Harbinson','3cce2948-0b9e-4f3c-b200-5d64a8759519'::uuid,'2026-07-31','In Progress','High',NULL),
  ('Marketing & Creative','UK PR -  Investor Agency - Strategy','Tim Hunt','0dc76d15-cd2c-4588-b4e7-1b3ccda5942a'::uuid,'2026-07-31','In Progress','High',NULL),
  ('Operations','Deliver Spencer Partner Day','Arzoo Gaur','73dc6ae9-36a9-4085-8634-0ea2b31817ab'::uuid,'2026-08-28','In Progress','High',NULL),
  ('Operations','Plan for Schools KPL','Simon Wood','e68a2e97-e700-4e52-8f83-fd3e9236724b'::uuid,'2026-09-30','In Progress','High',NULL),
  ('Operations','Website rebuild','Simon Wood','e68a2e97-e700-4e52-8f83-fd3e9236724b'::uuid,'2026-08-28','In Progress','High',NULL),
  ('Culture','Duncan Adoption','Simon Wood','e68a2e97-e700-4e52-8f83-fd3e9236724b'::uuid,'2026-08-28','Not Started','Medium',NULL),
  ('Culture','Performance Reviews','Simon Wood','e68a2e97-e700-4e52-8f83-fd3e9236724b'::uuid,'2026-09-30','Not Started','Medium',NULL),
  ('Culture','Recruitment Process','Simon Wood','e68a2e97-e700-4e52-8f83-fd3e9236724b'::uuid,'2026-08-28','In Progress','Medium',NULL),
  ('Culture','Onboarding Process','Arzoo Gaur','73dc6ae9-36a9-4085-8634-0ea2b31817ab'::uuid,'2026-08-28','In Progress','Medium',NULL),
  ('Legal & Compliance','Manufacturing Contract','Ellaine Gelman','6fc5c4b6-cc4e-409e-9558-ed90bd864943'::uuid,'2026-07-31','In Progress','High',NULL),
  ('Legal & Compliance','School Agreements','Ellaine Gelman','6fc5c4b6-cc4e-409e-9558-ed90bd864943'::uuid,'2026-07-31','In Progress','High',NULL),
  ('Legal & Compliance','Legal Compliance for Product & App','Ellaine Gelman','6fc5c4b6-cc4e-409e-9558-ed90bd864943'::uuid,'2026-09-30','In Progress','High',NULL),
  ('Legal & Compliance','Legal Structure in India','Ellaine Gelman','6fc5c4b6-cc4e-409e-9558-ed90bd864943'::uuid,'2026-10-30','In Progress','Medium',NULL),
  ('Legal & Compliance','IP Protection','Ellaine Gelman','6fc5c4b6-cc4e-409e-9558-ed90bd864943'::uuid,'2026-10-30','In Progress','High',NULL),
  ('Legal & Compliance','Corporate Governance','Ellaine Gelman','6fc5c4b6-cc4e-409e-9558-ed90bd864943'::uuid,'2026-08-28','In Progress','High',NULL),
  ('Finance','Monitoring of Top 5 Partnerships','Patrick Badenoch','00347694-6eab-4cc6-819a-01f13660f869'::uuid,'2026-09-30','In Progress','Medium',NULL),
  ('Finance','Successfully close the current investment round','Patrick Badenoch','00347694-6eab-4cc6-819a-01f13660f869'::uuid,'2026-09-30','In Progress','Critical',NULL),
  ('Finance','Secure sufficient runway into early 2027','Patrick Badenoch','00347694-6eab-4cc6-819a-01f13660f869'::uuid,'2026-09-30','In Progress','Critical',NULL),
  ('Key Metrics','OKR Framework','Simon Wood','e68a2e97-e700-4e52-8f83-fd3e9236724b'::uuid,'2026-08-28','In Progress','High',NULL),
  ('Key Metrics','Define KPIs & Dashboard','Simon Wood','e68a2e97-e700-4e52-8f83-fd3e9236724b'::uuid,'2026-08-28','Not Started','High',NULL),
  ('India','Build Resource Plans and Operating Model','Simon Wood','e68a2e97-e700-4e52-8f83-fd3e9236724b'::uuid,'2026-09-30','Not Started','Critical',NULL),
  ('India','400 Schools Signed by End of September','Nimesh Patel','517bf518-6111-41b8-9ff0-1249f3055ec7'::uuid,'2026-09-30','In Progress','Critical','Weekly Tracking')
)
INSERT INTO public.plan90_deliverables (workstream_id, title, owner_user_id, owner_display_name, due_date, status, priority, notes)
SELECT w.id, s.title, s.owner_uid, s.owner_name, s.due, s.status, s.priority, s.notes
FROM src s JOIN public.plan90_workstreams w ON w.name = s.ws
ON CONFLICT (workstream_id, lower(title)) DO NOTHING;


-- Suppliers table
CREATE TABLE public.suppliers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'supplier', -- supplier | stakeholder | partner
  website TEXT,
  logo_url TEXT,
  services TEXT[] NOT NULL DEFAULT '{}',
  contract_status TEXT, -- active | pending | expired | none
  rate TEXT, -- free-text e.g. "£500/day"
  currency TEXT DEFAULT 'GBP',
  renewal_date DATE,
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view suppliers"
ON public.suppliers FOR SELECT TO authenticated
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins can manage suppliers"
ON public.suppliers FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER update_suppliers_updated_at
BEFORE UPDATE ON public.suppliers
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Contacts
CREATE TABLE public.supplier_contacts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  supplier_id UUID NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  role TEXT,
  email TEXT,
  phone TEXT,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.supplier_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view supplier contacts"
ON public.supplier_contacts FOR SELECT TO authenticated
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins can manage supplier contacts"
ON public.supplier_contacts FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER update_supplier_contacts_updated_at
BEFORE UPDATE ON public.supplier_contacts
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_supplier_contacts_supplier_id ON public.supplier_contacts(supplier_id);

-- Link to workstreams
CREATE TABLE public.supplier_workstreams (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  supplier_id UUID NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  workstream_card_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (supplier_id, workstream_card_id)
);

ALTER TABLE public.supplier_workstreams ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view supplier workstreams"
ON public.supplier_workstreams FOR SELECT TO authenticated
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins can manage supplier workstreams"
ON public.supplier_workstreams FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX idx_supplier_workstreams_supplier_id ON public.supplier_workstreams(supplier_id);
CREATE INDEX idx_supplier_workstreams_card_id ON public.supplier_workstreams(workstream_card_id);

-- Logo storage bucket
INSERT INTO storage.buckets (id, name, public) VALUES ('supplier-logos', 'supplier-logos', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Supplier logos publicly readable"
ON storage.objects FOR SELECT
USING (bucket_id = 'supplier-logos');

CREATE POLICY "Admins can upload supplier logos"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'supplier-logos' AND has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can update supplier logos"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'supplier-logos' AND has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete supplier logos"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'supplier-logos' AND has_role(auth.uid(), 'admin'::app_role));

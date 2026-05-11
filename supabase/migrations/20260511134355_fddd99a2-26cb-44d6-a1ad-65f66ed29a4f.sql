
-- 1. App settings (single-row config) for fixed travel approver
CREATE TABLE IF NOT EXISTS public.app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view app settings"
  ON public.app_settings FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins can manage app settings"
  ON public.app_settings FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 2. Travel requests table
CREATE TYPE public.travel_status AS ENUM ('pending_approval','approved','rejected','cancelled');
CREATE TYPE public.travel_transport AS ENUM ('flight','train','car','other');

CREATE TABLE public.travel_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference text NOT NULL UNIQUE,
  requester_id uuid NOT NULL,
  traveller_user_id uuid,
  traveller_name text NOT NULL,
  purpose text NOT NULL,
  destination_city text NOT NULL,
  destination_country text NOT NULL,
  depart_date date NOT NULL,
  return_date date NOT NULL,
  transport_mode public.travel_transport NOT NULL DEFAULT 'flight',
  accommodation_needed boolean NOT NULL DEFAULT false,
  estimated_cost numeric NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'GBP',
  notes text,
  attachment_path text,
  status public.travel_status NOT NULL DEFAULT 'pending_approval',
  approver_user_id uuid,
  approved_by uuid,
  approved_at timestamptz,
  rejection_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_travel_requests_requester ON public.travel_requests(requester_id);
CREATE INDEX idx_travel_requests_approver ON public.travel_requests(approver_user_id);
CREATE INDEX idx_travel_requests_status ON public.travel_requests(status);

ALTER TABLE public.travel_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Requesters view own travel requests"
  ON public.travel_requests FOR SELECT TO authenticated
  USING (auth.uid() = requester_id OR auth.uid() = approver_user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Authenticated can create travel requests"
  ON public.travel_requests FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = requester_id);

CREATE POLICY "Approver requester or admin can update"
  ON public.travel_requests FOR UPDATE TO authenticated
  USING (auth.uid() = requester_id OR auth.uid() = approver_user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Requester or admin can delete"
  ON public.travel_requests FOR DELETE TO authenticated
  USING (auth.uid() = requester_id OR public.has_role(auth.uid(), 'admin'));

-- 3. Reference number generator
CREATE OR REPLACE FUNCTION public.generate_travel_reference()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  next_num integer;
BEGIN
  IF NEW.reference IS NULL OR NEW.reference = '' THEN
    SELECT COALESCE(MAX(CAST(SUBSTRING(reference FROM 'TR-(\d+)') AS INTEGER)), 0) + 1
      INTO next_num FROM public.travel_requests;
    NEW.reference := 'TR-' || LPAD(next_num::text, 5, '0');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_travel_requests_reference
BEFORE INSERT ON public.travel_requests
FOR EACH ROW EXECUTE FUNCTION public.generate_travel_reference();

-- 4. Default approver from app_settings on insert
CREATE OR REPLACE FUNCTION public.apply_travel_default_approver()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_approver uuid;
BEGIN
  IF NEW.approver_user_id IS NULL THEN
    SELECT (value->>'travel_approver_user_id')::uuid INTO v_approver
      FROM public.app_settings WHERE key = 'travel_approver';
    NEW.approver_user_id := v_approver;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_travel_default_approver
BEFORE INSERT ON public.travel_requests
FOR EACH ROW EXECUTE FUNCTION public.apply_travel_default_approver();

-- 5. updated_at
CREATE TRIGGER trg_travel_updated_at
BEFORE UPDATE ON public.travel_requests
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 6. Sync to approvals inbox
CREATE OR REPLACE FUNCTION public.sync_travel_to_inbox()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  mapped_status public.approval_status;
  inbox_title text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.approvals
      WHERE source_table = 'travel_requests' AND source_id = OLD.id;
    RETURN OLD;
  END IF;

  IF NEW.approver_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  mapped_status := CASE NEW.status::text
    WHEN 'approved' THEN 'approved'::public.approval_status
    WHEN 'rejected' THEN 'rejected'::public.approval_status
    WHEN 'cancelled' THEN 'cancelled'::public.approval_status
    ELSE 'pending'::public.approval_status
  END;

  inbox_title := NEW.reference || ' — ' || NEW.traveller_name || ' → ' ||
    NEW.destination_city || ', ' || NEW.destination_country;

  INSERT INTO public.approvals (
    kind, source_table, source_id, title, summary,
    amount, currency, status, requested_by,
    approver_user_id, decision_note, decided_at, due_at, link_path
  ) VALUES (
    'travel', 'travel_requests', NEW.id,
    inbox_title,
    NEW.purpose,
    NEW.estimated_cost, NEW.currency, mapped_status, NEW.requester_id,
    NEW.approver_user_id, NEW.rejection_reason, NEW.approved_at,
    NEW.depart_date::timestamptz,
    '/travel'
  )
  ON CONFLICT (source_table, source_id, COALESCE(approver_user_id, '00000000-0000-0000-0000-000000000000'::uuid)) DO UPDATE SET
    title = EXCLUDED.title,
    summary = EXCLUDED.summary,
    amount = EXCLUDED.amount,
    currency = EXCLUDED.currency,
    status = EXCLUDED.status,
    decision_note = EXCLUDED.decision_note,
    decided_at = EXCLUDED.decided_at,
    due_at = EXCLUDED.due_at,
    approver_user_id = EXCLUDED.approver_user_id,
    updated_at = now();

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_travel_sync_inbox
AFTER INSERT OR UPDATE OR DELETE ON public.travel_requests
FOR EACH ROW EXECUTE FUNCTION public.sync_travel_to_inbox();


-- 1. Enum for approval kind
DO $$ BEGIN
  CREATE TYPE public.approval_kind AS ENUM ('cost', 'event_date', 'release', 'hire', 'contract', 'other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.approval_status AS ENUM ('pending', 'approved', 'rejected', 'changes_requested', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. Generic approvals table
CREATE TABLE IF NOT EXISTS public.approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind public.approval_kind NOT NULL,
  source_table TEXT NOT NULL,
  source_id UUID NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  amount NUMERIC(14,2),
  currency TEXT DEFAULT 'GBP',
  status public.approval_status NOT NULL DEFAULT 'pending',
  requested_by UUID,
  approver_profile_id UUID,
  approver_user_id UUID,
  decision_note TEXT,
  decided_at TIMESTAMPTZ,
  due_at TIMESTAMPTZ,
  link_path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_table, source_id)
);

CREATE INDEX IF NOT EXISTS approvals_status_idx ON public.approvals (status);
CREATE INDEX IF NOT EXISTS approvals_approver_idx ON public.approvals (approver_user_id);
CREATE INDEX IF NOT EXISTS approvals_requester_idx ON public.approvals (requested_by);
CREATE INDEX IF NOT EXISTS approvals_kind_idx ON public.approvals (kind);

ALTER TABLE public.approvals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view approvals inbox"
  ON public.approvals FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Approver or requester can update approvals"
  ON public.approvals FOR UPDATE TO authenticated
  USING (
    auth.uid() = requested_by
    OR auth.uid() = approver_user_id
    OR has_role(auth.uid(), 'admin'::app_role)
  );

CREATE POLICY "Admins can insert approvals"
  ON public.approvals FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete approvals"
  ON public.approvals FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER approvals_updated_at
  BEFORE UPDATE ON public.approvals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. Sync function from key_event_approvals -> approvals
CREATE OR REPLACE FUNCTION public.sync_event_approval_to_inbox()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  ev_title TEXT;
  ev_start TIMESTAMPTZ;
  approver_uid UUID;
  mapped_status public.approval_status;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.approvals
      WHERE source_table = 'key_event_approvals' AND source_id = OLD.id;
    RETURN OLD;
  END IF;

  SELECT title, start_at INTO ev_title, ev_start
    FROM public.key_events WHERE id = NEW.event_id;

  SELECT user_id INTO approver_uid
    FROM public.profiles WHERE id = NEW.approver_profile_id;

  mapped_status := CASE NEW.status::text
    WHEN 'approved' THEN 'approved'::public.approval_status
    WHEN 'rejected' THEN 'rejected'::public.approval_status
    WHEN 'proposed' THEN 'changes_requested'::public.approval_status
    ELSE 'pending'::public.approval_status
  END;

  INSERT INTO public.approvals (
    kind, source_table, source_id, title, summary,
    status, requested_by, approver_profile_id, approver_user_id,
    decision_note, decided_at, due_at, link_path
  ) VALUES (
    'event_date', 'key_event_approvals', NEW.id,
    COALESCE(ev_title, 'Event approval') || ' — ' || NEW.approval_type,
    NEW.label,
    mapped_status,
    NEW.requested_by, NEW.approver_profile_id, approver_uid,
    NEW.decision_note, NEW.decided_at, ev_start,
    '/diary?event=' || NEW.event_id::text
  )
  ON CONFLICT (source_table, source_id) DO UPDATE SET
    status = EXCLUDED.status,
    summary = EXCLUDED.summary,
    decision_note = EXCLUDED.decision_note,
    decided_at = EXCLUDED.decided_at,
    approver_profile_id = EXCLUDED.approver_profile_id,
    approver_user_id = EXCLUDED.approver_user_id,
    due_at = EXCLUDED.due_at,
    updated_at = now();

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS sync_event_approval_to_inbox_trg ON public.key_event_approvals;
CREATE TRIGGER sync_event_approval_to_inbox_trg
  AFTER INSERT OR UPDATE OR DELETE ON public.key_event_approvals
  FOR EACH ROW EXECUTE FUNCTION public.sync_event_approval_to_inbox();

-- 4. Sync function from purchase_orders -> approvals
CREATE OR REPLACE FUNCTION public.sync_po_to_inbox()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  approver_uid UUID;
  mapped_status public.approval_status;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.approvals
      WHERE source_table = 'purchase_orders' AND source_id = OLD.id;
    RETURN OLD;
  END IF;

  -- Only track POs that need approval or have been actioned (skip 'draft')
  IF NEW.status = 'draft' THEN
    DELETE FROM public.approvals
      WHERE source_table = 'purchase_orders' AND source_id = NEW.id;
    RETURN NEW;
  END IF;

  -- Resolve approver: dept owner for tier 'department_owner', else null (admin pool)
  IF NEW.approval_tier = 'department_owner' THEN
    SELECT owner_user_id INTO approver_uid
      FROM public.departments WHERE id = NEW.department_id;
  ELSE
    approver_uid := NULL;
  END IF;

  mapped_status := CASE NEW.status::text
    WHEN 'approved' THEN 'approved'::public.approval_status
    WHEN 'rejected' THEN 'rejected'::public.approval_status
    WHEN 'cancelled' THEN 'cancelled'::public.approval_status
    ELSE 'pending'::public.approval_status
  END;

  INSERT INTO public.approvals (
    kind, source_table, source_id, title, summary,
    amount, currency, status, requested_by,
    approver_user_id, decision_note, decided_at, link_path
  ) VALUES (
    'cost', 'purchase_orders', NEW.id,
    NEW.po_number || ' — ' || NEW.vendor_name,
    NEW.description,
    NEW.total_amount, 'GBP', mapped_status, NEW.requester_id,
    approver_uid, NEW.rejection_reason, NEW.approved_at,
    '/purchase-orders'
  )
  ON CONFLICT (source_table, source_id) DO UPDATE SET
    title = EXCLUDED.title,
    summary = EXCLUDED.summary,
    amount = EXCLUDED.amount,
    status = EXCLUDED.status,
    approver_user_id = EXCLUDED.approver_user_id,
    decision_note = EXCLUDED.decision_note,
    decided_at = EXCLUDED.decided_at,
    updated_at = now();

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS sync_po_to_inbox_trg ON public.purchase_orders;
CREATE TRIGGER sync_po_to_inbox_trg
  AFTER INSERT OR UPDATE OR DELETE ON public.purchase_orders
  FOR EACH ROW EXECUTE FUNCTION public.sync_po_to_inbox();

-- 5. Backfill existing rows
INSERT INTO public.approvals (
  kind, source_table, source_id, title, summary,
  status, requested_by, approver_profile_id, approver_user_id,
  decision_note, decided_at, due_at, link_path
)
SELECT
  'event_date'::public.approval_kind,
  'key_event_approvals',
  kea.id,
  COALESCE(ke.title, 'Event approval') || ' — ' || kea.approval_type,
  kea.label,
  CASE kea.status::text
    WHEN 'approved' THEN 'approved'::public.approval_status
    WHEN 'rejected' THEN 'rejected'::public.approval_status
    WHEN 'proposed' THEN 'changes_requested'::public.approval_status
    ELSE 'pending'::public.approval_status
  END,
  kea.requested_by,
  kea.approver_profile_id,
  p.user_id,
  kea.decision_note,
  kea.decided_at,
  ke.start_at,
  '/diary?event=' || kea.event_id::text
FROM public.key_event_approvals kea
LEFT JOIN public.key_events ke ON ke.id = kea.event_id
LEFT JOIN public.profiles p ON p.id = kea.approver_profile_id
ON CONFLICT (source_table, source_id) DO NOTHING;

INSERT INTO public.approvals (
  kind, source_table, source_id, title, summary,
  amount, currency, status, requested_by,
  approver_user_id, decision_note, decided_at, link_path
)
SELECT
  'cost'::public.approval_kind,
  'purchase_orders',
  po.id,
  po.po_number || ' — ' || po.vendor_name,
  po.description,
  po.total_amount, 'GBP',
  CASE po.status::text
    WHEN 'approved' THEN 'approved'::public.approval_status
    WHEN 'rejected' THEN 'rejected'::public.approval_status
    WHEN 'cancelled' THEN 'cancelled'::public.approval_status
    ELSE 'pending'::public.approval_status
  END,
  po.requester_id,
  CASE WHEN po.approval_tier = 'department_owner'
       THEN (SELECT owner_user_id FROM public.departments WHERE id = po.department_id)
       ELSE NULL END,
  po.rejection_reason,
  po.approved_at,
  '/purchase-orders'
FROM public.purchase_orders po
WHERE po.status <> 'draft'
ON CONFLICT (source_table, source_id) DO NOTHING;

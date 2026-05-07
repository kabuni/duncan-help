-- Allow requester to nominate a specific approver (Planner-style)
ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS approver_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_po_approver_user_id ON public.purchase_orders(approver_user_id);

-- Update inbox sync to prefer the nominated approver if provided
CREATE OR REPLACE FUNCTION public.sync_po_to_inbox()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  approver_uid UUID;
  mapped_status public.approval_status;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.approvals
      WHERE source_table = 'purchase_orders' AND source_id = OLD.id;
    RETURN OLD;
  END IF;

  IF NEW.status = 'draft' THEN
    DELETE FROM public.approvals
      WHERE source_table = 'purchase_orders' AND source_id = NEW.id;
    RETURN NEW;
  END IF;

  IF NEW.approver_user_id IS NOT NULL THEN
    approver_uid := NEW.approver_user_id;
  ELSIF NEW.approval_tier = 'department_owner' THEN
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
END $function$;
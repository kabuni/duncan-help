
-- 1. Add dual-approver tracking columns
ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS secondary_approver_user_id UUID,
  ADD COLUMN IF NOT EXISTS secondary_approved_by UUID,
  ADD COLUMN IF NOT EXISTS secondary_approved_at TIMESTAMPTZ;

-- 2. Update routing function with hard-coded approvers
CREATE OR REPLACE FUNCTION public.set_po_approval_tier()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  simon_id   UUID := 'e68a2e97-e700-4e52-8f83-fd3e9236724b';
  nimesh_id  UUID := '517bf518-6111-41b8-9ff0-1249f3055ec7';
  patrick_id UUID := '00347694-6eab-4cc6-819a-01f13660f869';
BEGIN
  -- Only set tier/routing on initial submission (when status is being created or moved out of draft)
  IF TG_OP = 'INSERT' OR (OLD.status = 'draft' AND NEW.status <> 'draft') THEN
    IF NEW.total_amount < 500 THEN
      NEW.approval_tier := 'auto';
      NEW.status := 'approved';
      NEW.approved_at := now();
      NEW.approver_user_id := NULL;
      NEW.secondary_approver_user_id := NULL;
    ELSIF NEW.total_amount <= 5000 THEN
      NEW.approval_tier := 'simon';
      NEW.status := 'pending_approval';
      -- Respect manual override; otherwise default to Simon
      IF NEW.approver_user_id IS NULL THEN
        NEW.approver_user_id := simon_id;
      END IF;
      NEW.secondary_approver_user_id := NULL;
    ELSE
      NEW.approval_tier := 'dual_exec';
      NEW.status := 'pending_approval';
      IF NEW.approver_user_id IS NULL THEN
        NEW.approver_user_id := nimesh_id;
      END IF;
      IF NEW.secondary_approver_user_id IS NULL THEN
        NEW.secondary_approver_user_id := patrick_id;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- 3. Trigger to auto-flip status to 'approved' once all required approvers have signed
CREATE OR REPLACE FUNCTION public.finalize_po_dual_approval()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Only consider when still pending and at least one approval has been recorded
  IF NEW.status = 'pending_approval' THEN
    IF NEW.secondary_approver_user_id IS NOT NULL THEN
      -- Dual sign-off path: both must have approved
      IF NEW.approved_at IS NOT NULL AND NEW.secondary_approved_at IS NOT NULL THEN
        NEW.status := 'approved';
      END IF;
    ELSE
      -- Single approver path: primary approval is enough
      IF NEW.approved_at IS NOT NULL THEN
        NEW.status := 'approved';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_finalize_po_dual_approval ON public.purchase_orders;
CREATE TRIGGER trg_finalize_po_dual_approval
  BEFORE UPDATE ON public.purchase_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.finalize_po_dual_approval();

-- 4. Replace approvals unique constraint to allow one row per (PO, approver)
ALTER TABLE public.approvals
  DROP CONSTRAINT IF EXISTS approvals_source_table_source_id_key;

DROP INDEX IF EXISTS public.approvals_source_table_source_id_key;
DROP INDEX IF EXISTS public.approvals_source_unique_idx;

CREATE UNIQUE INDEX IF NOT EXISTS approvals_source_approver_unique_idx
  ON public.approvals (source_table, source_id, COALESCE(approver_user_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- 5. Update sync_po_to_inbox to emit one row per approver (primary + secondary)
CREATE OR REPLACE FUNCTION public.sync_po_to_inbox()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  mapped_status public.approval_status;
  primary_status public.approval_status;
  secondary_status public.approval_status;
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

  mapped_status := CASE NEW.status::text
    WHEN 'approved' THEN 'approved'::public.approval_status
    WHEN 'rejected' THEN 'rejected'::public.approval_status
    WHEN 'cancelled' THEN 'cancelled'::public.approval_status
    ELSE 'pending'::public.approval_status
  END;

  -- Primary approver row
  IF NEW.approver_user_id IS NOT NULL THEN
    primary_status := CASE
      WHEN NEW.status::text = 'rejected' THEN 'rejected'::public.approval_status
      WHEN NEW.status::text = 'cancelled' THEN 'cancelled'::public.approval_status
      WHEN NEW.approved_at IS NOT NULL THEN 'approved'::public.approval_status
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
      NEW.total_amount, 'GBP', primary_status, NEW.requester_id,
      NEW.approver_user_id, NEW.rejection_reason, NEW.approved_at,
      '/purchase-orders'
    )
    ON CONFLICT (source_table, source_id, COALESCE(approver_user_id, '00000000-0000-0000-0000-000000000000'::uuid)) DO UPDATE SET
      title = EXCLUDED.title,
      summary = EXCLUDED.summary,
      amount = EXCLUDED.amount,
      status = EXCLUDED.status,
      decision_note = EXCLUDED.decision_note,
      decided_at = EXCLUDED.decided_at,
      updated_at = now();
  END IF;

  -- Secondary approver row (dual sign-off)
  IF NEW.secondary_approver_user_id IS NOT NULL THEN
    secondary_status := CASE
      WHEN NEW.status::text = 'rejected' THEN 'rejected'::public.approval_status
      WHEN NEW.status::text = 'cancelled' THEN 'cancelled'::public.approval_status
      WHEN NEW.secondary_approved_at IS NOT NULL THEN 'approved'::public.approval_status
      ELSE 'pending'::public.approval_status
    END;

    INSERT INTO public.approvals (
      kind, source_table, source_id, title, summary,
      amount, currency, status, requested_by,
      approver_user_id, decision_note, decided_at, link_path
    ) VALUES (
      'cost', 'purchase_orders', NEW.id,
      NEW.po_number || ' — ' || NEW.vendor_name || ' (co-approval)',
      NEW.description,
      NEW.total_amount, 'GBP', secondary_status, NEW.requester_id,
      NEW.secondary_approver_user_id, NEW.rejection_reason, NEW.secondary_approved_at,
      '/purchase-orders'
    )
    ON CONFLICT (source_table, source_id, COALESCE(approver_user_id, '00000000-0000-0000-0000-000000000000'::uuid)) DO UPDATE SET
      title = EXCLUDED.title,
      summary = EXCLUDED.summary,
      amount = EXCLUDED.amount,
      status = EXCLUDED.status,
      decision_note = EXCLUDED.decision_note,
      decided_at = EXCLUDED.decided_at,
      updated_at = now();
  ELSE
    -- Clean up any orphaned secondary row if downgraded
    DELETE FROM public.approvals
      WHERE source_table = 'purchase_orders'
        AND source_id = NEW.id
        AND approver_user_id IS NOT NULL
        AND approver_user_id <> NEW.approver_user_id;
  END IF;

  RETURN NEW;
END;
$function$;

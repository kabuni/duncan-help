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
  IF TG_OP = 'INSERT' OR (OLD.status = 'draft' AND NEW.status <> 'draft') THEN
    -- Marketing & Creative requests are NOT purchase orders. They always
    -- require explicit approver sign-off and never auto-approve regardless of cost.
    IF NEW.category IN ('marketing', 'creative') THEN
      NEW.approval_tier := 'creative';
      NEW.status := 'pending_approval';
      -- Approvers must be set by the requester; fall back to dual exec if missing.
      IF NEW.approver_user_id IS NULL THEN
        NEW.approver_user_id := nimesh_id;
      END IF;
      IF NEW.secondary_approver_user_id IS NULL THEN
        NEW.secondary_approver_user_id := patrick_id;
      END IF;
    ELSIF NEW.total_amount < 500 THEN
      NEW.approval_tier := 'auto';
      NEW.status := 'approved';
      NEW.approved_at := now();
      NEW.approver_user_id := NULL;
      NEW.secondary_approver_user_id := NULL;
    ELSIF NEW.total_amount <= 5000 THEN
      NEW.approval_tier := 'simon';
      NEW.status := 'pending_approval';
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
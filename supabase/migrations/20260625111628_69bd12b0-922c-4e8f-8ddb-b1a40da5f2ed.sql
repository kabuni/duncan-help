CREATE OR REPLACE FUNCTION public.sync_event_approval_to_inbox()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
  ON CONFLICT (source_table, source_id, COALESCE(approver_user_id, '00000000-0000-0000-0000-000000000000'::uuid)) DO UPDATE SET
    status = EXCLUDED.status,
    summary = EXCLUDED.summary,
    decision_note = EXCLUDED.decision_note,
    decided_at = EXCLUDED.decided_at,
    approver_profile_id = EXCLUDED.approver_profile_id,
    approver_user_id = EXCLUDED.approver_user_id,
    due_at = EXCLUDED.due_at,
    updated_at = now();

  RETURN NEW;
END $function$;
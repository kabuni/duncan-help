CREATE OR REPLACE FUNCTION public.sync_event_approval_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_event_id uuid;
  v_pending int;
  v_rejected int;
  v_approved int;
  v_total int;
  v_new_state text;
BEGIN
  v_event_id := COALESCE(NEW.event_id, OLD.event_id);
  IF v_event_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT
    COUNT(*) FILTER (WHERE status IN ('pending','proposed')),
    COUNT(*) FILTER (WHERE status = 'rejected'),
    COUNT(*) FILTER (WHERE status = 'approved'),
    COUNT(*)
  INTO v_pending, v_rejected, v_approved, v_total
  FROM public.key_event_approvals
  WHERE event_id = v_event_id;

  IF v_pending > 0 THEN
    v_new_state := 'pending';
  ELSIF v_rejected > 0 THEN
    v_new_state := 'rejected';
  ELSIF v_total > 0 AND v_approved = v_total THEN
    v_new_state := 'approved';
  ELSE
    v_new_state := NULL;
  END IF;

  UPDATE public.key_events
     SET approval_state = v_new_state
   WHERE id = v_event_id
     AND approval_state IS DISTINCT FROM v_new_state;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Backfill current derived states using the corrected precedence.
UPDATE public.key_events e
SET approval_state = sub.state
FROM (
  SELECT event_id,
    CASE
      WHEN COUNT(*) FILTER (WHERE status IN ('pending','proposed')) > 0 THEN 'pending'
      WHEN COUNT(*) FILTER (WHERE status = 'rejected') > 0 THEN 'rejected'
      WHEN COUNT(*) > 0 AND COUNT(*) FILTER (WHERE status = 'approved') = COUNT(*) THEN 'approved'
      ELSE NULL
    END AS state
  FROM public.key_event_approvals
  GROUP BY event_id
) sub
WHERE e.id = sub.event_id
  AND e.approval_state IS DISTINCT FROM sub.state;

-- Let active Planner clients refresh when event state changes or events are removed.
ALTER TABLE public.key_events REPLICA IDENTITY FULL;
ALTER TABLE public.key_event_approvals REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'key_events'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.key_events;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'key_event_approvals'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.key_event_approvals;
  END IF;
END $$;
ALTER TABLE public.key_events
  ADD COLUMN IF NOT EXISTS approval_state text;

CREATE INDEX IF NOT EXISTS idx_key_events_approval_state
  ON public.key_events(approval_state);

CREATE OR REPLACE FUNCTION public.sync_event_approval_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_event_id uuid;
  v_pending int;
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
    COUNT(*) FILTER (WHERE status = 'approved'),
    COUNT(*)
  INTO v_pending, v_approved, v_total
  FROM public.key_event_approvals
  WHERE event_id = v_event_id;

  IF v_pending > 0 THEN
    v_new_state := 'pending';
  ELSIF v_approved > 0 THEN
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

DROP TRIGGER IF EXISTS trg_sync_event_approval_state ON public.key_event_approvals;
CREATE TRIGGER trg_sync_event_approval_state
AFTER INSERT OR UPDATE OR DELETE ON public.key_event_approvals
FOR EACH ROW EXECUTE FUNCTION public.sync_event_approval_state();

-- Backfill existing events
UPDATE public.key_events e
SET approval_state = sub.state
FROM (
  SELECT event_id,
    CASE
      WHEN COUNT(*) FILTER (WHERE status IN ('pending','proposed')) > 0 THEN 'pending'
      WHEN COUNT(*) FILTER (WHERE status = 'approved') > 0 THEN 'approved'
      ELSE NULL
    END AS state
  FROM public.key_event_approvals
  GROUP BY event_id
) sub
WHERE e.id = sub.event_id
  AND e.approval_state IS DISTINCT FROM sub.state;
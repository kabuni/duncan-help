CREATE OR REPLACE FUNCTION public.enforce_public_holiday_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.category IN ('PublicHoliday', 'Public Holiday') THEN
    NEW.category := 'PublicHoliday';
    NEW.approval_state := 'approved';
    NEW.deleted_in_google := false;
    IF NEW.holiday_region IS NULL OR NEW.holiday_region = '' THEN
      NEW.holiday_region := 'Global';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_public_holiday_rules ON public.key_events;
CREATE TRIGGER trg_enforce_public_holiday_rules
  BEFORE INSERT OR UPDATE ON public.key_events
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_public_holiday_rules();

CREATE OR REPLACE FUNCTION public.sync_event_approval_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_id uuid;
  v_pending int;
  v_rejected int;
  v_approved int;
  v_total int;
  v_new_state text;
  v_category text;
BEGIN
  v_event_id := COALESCE(NEW.event_id, OLD.event_id);
  IF v_event_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT category INTO v_category FROM public.key_events WHERE id = v_event_id;
  IF v_category IN ('PublicHoliday', 'Public Holiday') THEN
    UPDATE public.key_events
       SET category = 'PublicHoliday',
           approval_state = 'approved',
           deleted_in_google = false,
           holiday_region = COALESCE(NULLIF(holiday_region, ''), 'Global')
     WHERE id = v_event_id
       AND (
         category IS DISTINCT FROM 'PublicHoliday'
         OR approval_state IS DISTINCT FROM 'approved'
         OR deleted_in_google IS DISTINCT FROM false
         OR holiday_region IS NULL
         OR holiday_region = ''
       );
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

UPDATE public.key_events
   SET category = 'PublicHoliday',
       approval_state = 'approved',
       deleted_in_google = false,
       holiday_region = COALESCE(NULLIF(holiday_region, ''), 'Global')
 WHERE category IN ('PublicHoliday', 'Public Holiday');
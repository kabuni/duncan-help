
-- Public Holiday system

-- 1. New column
ALTER TABLE public.key_events
  ADD COLUMN IF NOT EXISTS holiday_region text;

-- 2. Region helper - reads region from profiles.preferences.region
CREATE OR REPLACE FUNCTION public.get_user_region(_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(NULLIF(preferences->>'region', ''), NULL)
  FROM public.profiles
  WHERE user_id = _user_id
  LIMIT 1;
$$;

-- 3. Visibility helper for holidays. Future-proof: add more rows to the
--    matching CASE without changing approval logic elsewhere.
CREATE OR REPLACE FUNCTION public.can_view_holiday(_region text, _user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_region text;
BEGIN
  -- Global is visible to everyone (and is the safe default).
  IF _region IS NULL OR _region = 'Global' THEN
    RETURN true;
  END IF;

  v_user_region := public.get_user_region(_user_id);
  IF v_user_region IS NULL THEN
    RETURN false;
  END IF;

  -- Exact match always wins.
  IF v_user_region = _region THEN
    RETURN true;
  END IF;

  -- "India" (country-level) is visible to all India-* sub-regions.
  IF _region = 'India' AND v_user_region IN ('India','India North','India South') THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

-- 4. Replace permissive SELECT policy with holiday-aware one.
DROP POLICY IF EXISTS "Authenticated users can view all key events" ON public.key_events;

CREATE POLICY "Authenticated users can view key events"
  ON public.key_events
  FOR SELECT
  TO authenticated
  USING (
    COALESCE(category, '') <> 'Public Holiday'
    OR public.can_view_holiday(holiday_region, auth.uid())
  );

-- 5. Trigger: Public Holidays never participate in approvals.
--    Force approval_state='approved' and default region to 'Global' if missing.
CREATE OR REPLACE FUNCTION public.enforce_public_holiday_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.category = 'Public Holiday' THEN
    NEW.approval_state := 'approved';
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

-- 6. Make sure the approval-rollup trigger never demotes a Public Holiday.
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
  -- Public Holidays bypass approval rollup entirely.
  IF v_category = 'Public Holiday' THEN
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


UPDATE public.key_events SET end_at = start_at WHERE category = 'PublicHoliday';

CREATE OR REPLACE FUNCTION public.enforce_public_holiday_rules()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.category = 'PublicHoliday' OR NEW.calendar_id = 'public-holiday' THEN
    NEW.category := 'PublicHoliday';
    NEW.calendar_id := 'public-holiday';
    NEW.approval_state := 'approved';
    NEW.deleted_in_google := false;
    NEW.all_day := true;
    NEW.end_at := NEW.start_at;
  END IF;
  RETURN NEW;
END;
$$;

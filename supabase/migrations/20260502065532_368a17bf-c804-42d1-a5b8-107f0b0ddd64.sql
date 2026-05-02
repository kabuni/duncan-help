
DROP VIEW IF EXISTS public.duncan_calendar_status;

-- Safe function: returns connection status only, no tokens.
CREATE OR REPLACE FUNCTION public.get_duncan_calendar_status()
RETURNS TABLE(
  connected boolean,
  google_account_email text,
  calendar_id text,
  calendar_name text,
  last_updated timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    true AS connected,
    t.google_account_email,
    t.calendar_id,
    t.calendar_name,
    t.updated_at AS last_updated
  FROM public.duncan_calendar_tokens t
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_duncan_calendar_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_duncan_calendar_status() TO authenticated;

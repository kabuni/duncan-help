CREATE OR REPLACE FUNCTION public.get_my_meetings(_limit integer DEFAULT 20, _scope text DEFAULT 'mine'::text)
 RETURNS SETOF meetings
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_is_admin boolean := public.has_role(v_uid, 'admin');
  v_email text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF _scope = 'all' THEN
    IF NOT v_is_admin THEN
      RAISE EXCEPTION 'Only admins may use scope=all';
    END IF;
    RETURN QUERY
      SELECT * FROM public.meetings
      ORDER BY COALESCE(meeting_date, created_at) DESC
      LIMIT _limit;
  ELSE
    SELECT email INTO v_email FROM auth.users WHERE id = v_uid;

    RETURN QUERY
      SELECT m.* FROM public.meetings m
      WHERE m.host_user_id = v_uid
         OR EXISTS (
           SELECT 1 FROM public.meeting_participants mp
           WHERE mp.meeting_id = m.id AND mp.user_id = v_uid
         )
         OR (
           v_email IS NOT NULL
           AND (
             lower(m.host_email) = lower(v_email)
             OR EXISTS (
               SELECT 1 FROM unnest(COALESCE(m.attendee_emails, ARRAY[]::text[])) ae
               WHERE lower(ae) = lower(v_email)
             )
           )
         )
         OR (
           m.fetched_by = v_uid
           AND COALESCE(m.meeting_date, m.created_at) >= NOW() - INTERVAL '48 hours'
         )
      ORDER BY COALESCE(m.meeting_date, m.created_at) DESC
      LIMIT _limit;
  END IF;
END;
$function$;
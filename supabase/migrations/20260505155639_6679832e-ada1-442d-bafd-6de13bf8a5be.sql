
DROP FUNCTION IF EXISTS public.backfill_meeting_ownership();

CREATE FUNCTION public.backfill_meeting_ownership()
 RETURNS TABLE(meeting_id uuid, matched_users integer, host_set boolean, participants_inserted integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  m RECORD;
  v_email text;
  v_emails text[];
  v_user_id uuid;
  v_user_email text;
  v_inserted int;
  v_matched int;
  v_host_uid uuid;
  v_host_email text;
  v_host_set boolean;
BEGIN
  FOR m IN SELECT * FROM public.meetings LOOP
    v_inserted := 0;
    v_matched := 0;
    v_host_set := false;
    v_host_uid := NULL;
    v_host_email := NULL;

    v_emails := ARRAY[]::text[];
    IF m.sender_email IS NOT NULL AND m.sender_email <> '' THEN
      v_emails := array_append(v_emails, lower(m.sender_email));
    END IF;
    IF m.host_email IS NOT NULL AND m.host_email <> '' THEN
      v_emails := array_append(v_emails, lower(m.host_email));
    END IF;
    IF m.attendee_emails IS NOT NULL THEN
      SELECT COALESCE(array_agg(DISTINCT e), ARRAY[]::text[])
        INTO v_emails
      FROM (
        SELECT unnest(v_emails) AS e
        UNION ALL
        SELECT lower(unnest(m.attendee_emails))
      ) s
      WHERE e IS NOT NULL AND e <> '';
    END IF;

    IF v_emails IS NOT NULL THEN
      FOREACH v_email IN ARRAY v_emails LOOP
        SELECT id, email INTO v_user_id, v_user_email
        FROM auth.users WHERE lower(email) = v_email LIMIT 1;
        IF v_user_id IS NOT NULL THEN
          INSERT INTO public.meeting_participants(meeting_id, user_id, email, role, match_confidence)
          VALUES (m.id, v_user_id, v_user_email, 'attendee', 1.0)
          ON CONFLICT DO NOTHING;
          IF FOUND THEN v_inserted := v_inserted + 1; END IF;
          v_matched := v_matched + 1;
          IF NOT v_host_set AND (lower(COALESCE(m.host_email, m.sender_email, '')) = v_email) THEN
            v_host_uid := v_user_id; v_host_email := v_user_email; v_host_set := true;
          END IF;
        END IF;
      END LOOP;
    END IF;

    UPDATE public.meetings
       SET host_user_id = v_host_uid,
           host_email = COALESCE(v_host_email, host_email)
     WHERE id = m.id;

    meeting_id := m.id;
    matched_users := v_matched;
    host_set := v_host_set;
    participants_inserted := v_inserted;
    RETURN NEXT;
  END LOOP;
END;
$function$;

DELETE FROM public.meeting_participants WHERE COALESCE(match_confidence, 0) < 1.0;

UPDATE public.meetings SET host_user_id = NULL;

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
           WHERE mp.meeting_id = m.id
             AND mp.user_id = v_uid
             AND COALESCE(mp.match_confidence, 0) >= 1.0
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
      ORDER BY COALESCE(m.meeting_date, m.created_at) DESC
      LIMIT _limit;
  END IF;
END;
$function$;

DROP POLICY IF EXISTS "Users view their meetings" ON public.meetings;
CREATE POLICY "Users view their meetings"
ON public.meetings
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR host_user_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.meeting_participants mp
    WHERE mp.meeting_id = meetings.id
      AND mp.user_id = auth.uid()
      AND COALESCE(mp.match_confidence, 0) >= 1.0
  )
  OR EXISTS (
    SELECT 1
    FROM auth.users u
    WHERE u.id = auth.uid()
      AND u.email IS NOT NULL
      AND (
        lower(meetings.host_email) = lower(u.email)
        OR lower(u.email) = ANY (SELECT lower(x) FROM unnest(COALESCE(meetings.attendee_emails, ARRAY[]::text[])) x)
      )
  )
);

SELECT public.backfill_meeting_ownership();

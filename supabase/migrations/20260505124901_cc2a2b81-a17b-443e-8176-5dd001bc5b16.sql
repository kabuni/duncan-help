
-- 1) Rewrite backfill with strict matching: exact (1.0) and case-insensitive full-name (0.95) only,
--    insert participants only if confidence >= 0.8, host only if >= 0.9, no fetched_by host fallback.
CREATE OR REPLACE FUNCTION public.backfill_meeting_ownership()
 RETURNS TABLE(meeting_id uuid, matched_users integer, unmatched_names text[], host_set boolean, participants_inserted integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  m RECORD;
  v_text text;
  v_email text;
  v_emails text[];
  v_name text;
  v_names text[];
  v_unmatched text[];
  v_user_id uuid;
  v_user_email text;
  v_inserted int;
  v_matched int;
  v_host_uid uuid;
  v_host_email text;
  v_host_set boolean;
  v_conf numeric;
  EMAIL_RE constant text := '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}';
  NAME_RE  constant text := '(^|\n)\s*([A-Z][a-zA-Z''\-]+(?:\s+[A-Z][a-zA-Z''\-]+){0,2})\s*:';
  MIN_PARTICIPANT_CONF constant numeric := 0.8;
  MIN_HOST_CONF constant numeric := 0.9;
BEGIN
  FOR m IN SELECT * FROM public.meetings LOOP
    v_text := COALESCE(m.transcript,'') || E'\n' || COALESCE(m.email_subject,'') || E'\n' || COALESCE(m.summary,'') || E'\n' || COALESCE(m.sender_email,'');
    v_unmatched := ARRAY[]::text[];
    v_inserted := 0;
    v_matched := 0;
    v_host_set := false;
    v_host_uid := NULL;
    v_host_email := NULL;

    -- Extract emails
    SELECT COALESCE(array_agg(DISTINCT lower(e)), ARRAY[]::text[])
      INTO v_emails
    FROM regexp_matches(v_text, EMAIL_RE, 'g') AS x(arr), unnest(arr) AS e;

    -- Extract speaker names
    SELECT COALESCE(array_agg(DISTINCT trim(arr[2])), ARRAY[]::text[])
      INTO v_names
    FROM regexp_matches(v_text, NAME_RE, 'g') AS y(arr);

    -- Email matches (confidence 1.0)
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
          IF NOT v_host_set THEN
            v_host_uid := v_user_id; v_host_email := v_user_email; v_host_set := true;
          END IF;
        END IF;
      END LOOP;
    END IF;

    -- Name matches: STRICT — exact (1.0) or case-insensitive full match (0.95). No prefix/substring.
    IF v_names IS NOT NULL THEN
      FOREACH v_name IN ARRAY v_names LOOP
        v_user_id := NULL; v_conf := NULL;

        -- Exact case-sensitive
        SELECT p.user_id, 1.0 INTO v_user_id, v_conf
        FROM public.profiles p
        WHERE p.display_name = v_name
        LIMIT 1;

        -- Case-insensitive full match
        IF v_user_id IS NULL THEN
          SELECT p.user_id, 0.95 INTO v_user_id, v_conf
          FROM public.profiles p
          WHERE lower(p.display_name) = lower(v_name)
          LIMIT 1;
        END IF;

        IF v_user_id IS NOT NULL AND v_conf >= MIN_PARTICIPANT_CONF THEN
          SELECT email INTO v_user_email FROM auth.users WHERE id = v_user_id;
          INSERT INTO public.meeting_participants(meeting_id, user_id, email, role, match_confidence)
          VALUES (m.id, v_user_id, v_user_email, 'speaker', v_conf)
          ON CONFLICT DO NOTHING;
          IF FOUND THEN v_inserted := v_inserted + 1; END IF;
          v_matched := v_matched + 1;
          IF NOT v_host_set AND v_conf >= MIN_HOST_CONF THEN
            v_host_uid := v_user_id; v_host_email := v_user_email; v_host_set := true;
          END IF;
        ELSE
          v_unmatched := array_append(v_unmatched, v_name);
        END IF;
      END LOOP;
    END IF;

    -- NO fetched_by host fallback. fetched_by stays as-is on meeting row but is not ownership.

    UPDATE public.meetings
       SET host_user_id = COALESCE(host_user_id, v_host_uid),
           host_email = COALESCE(host_email, v_host_email),
           attendee_emails = CASE WHEN attendee_emails IS NULL OR array_length(attendee_emails,1) IS NULL
                                  THEN v_emails ELSE attendee_emails END
     WHERE id = m.id;

    meeting_id := m.id;
    matched_users := v_matched;
    unmatched_names := v_unmatched;
    host_set := v_host_set;
    participants_inserted := v_inserted;
    RETURN NEXT;
  END LOOP;
END;
$function$;

-- 2) Purge previously inserted low-confidence participant rows (< 0.8)
DELETE FROM public.meeting_participants WHERE COALESCE(match_confidence, 0) < 0.8;

-- 3) Tighten get_my_meetings: require host OR high-confidence participant OR email match. No fetched_by fallback.
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
             AND COALESCE(mp.match_confidence, 0) >= 0.8
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

-- 4) Tighten RLS on meetings to mirror RPC (no fetched_by fallback)
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
      AND COALESCE(mp.match_confidence, 0) >= 0.8
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

-- 5) Re-run backfill with strict rules
SELECT public.backfill_meeting_ownership();

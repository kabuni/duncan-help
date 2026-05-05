
-- Backfill function for meeting ownership
CREATE OR REPLACE FUNCTION public.backfill_meeting_ownership()
RETURNS TABLE(
  meeting_id uuid,
  matched_users int,
  unmatched_names text[],
  host_set boolean,
  participants_inserted int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
BEGIN
  FOR m IN SELECT * FROM public.meetings LOOP
    v_text := COALESCE(m.transcript,'') || E'\n' || COALESCE(m.email_subject,'') || E'\n' || COALESCE(m.summary,'') || E'\n' || COALESCE(m.sender_email,'');
    v_unmatched := ARRAY[]::text[];
    v_inserted := 0;
    v_matched := 0;
    v_host_set := false;

    -- 1) Extract emails (dedup, lower)
    SELECT COALESCE(array_agg(DISTINCT lower(e)), ARRAY[]::text[])
      INTO v_emails
    FROM regexp_matches(v_text, EMAIL_RE, 'g') AS x(arr), unnest(arr) AS e;

    -- 2) Extract speaker names from "Name:" patterns
    SELECT COALESCE(array_agg(DISTINCT trim(arr[2])), ARRAY[]::text[])
      INTO v_names
    FROM regexp_matches(v_text, NAME_RE, 'g') AS y(arr);

    -- 3) Match emails -> auth.users
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

    -- 4) Match names -> profiles.display_name (case-insensitive exact, then substring)
    IF v_names IS NOT NULL THEN
      FOREACH v_name IN ARRAY v_names LOOP
        v_user_id := NULL; v_conf := NULL;

        SELECT p.user_id, 1.0 INTO v_user_id, v_conf
        FROM public.profiles p
        WHERE lower(p.display_name) = lower(v_name)
        LIMIT 1;

        IF v_user_id IS NULL THEN
          SELECT p.user_id, 0.7 INTO v_user_id, v_conf
          FROM public.profiles p
          WHERE p.display_name IS NOT NULL
            AND (lower(p.display_name) LIKE lower(v_name) || '%'
                 OR lower(v_name) LIKE lower(split_part(p.display_name,' ',1)) || '%')
          LIMIT 1;
        END IF;

        IF v_user_id IS NOT NULL THEN
          SELECT email INTO v_user_email FROM auth.users WHERE id = v_user_id;
          INSERT INTO public.meeting_participants(meeting_id, user_id, email, role, match_confidence)
          VALUES (m.id, v_user_id, v_user_email, 'speaker', v_conf)
          ON CONFLICT DO NOTHING;
          IF FOUND THEN v_inserted := v_inserted + 1; END IF;
          v_matched := v_matched + 1;
          IF NOT v_host_set AND v_conf >= 0.9 THEN
            v_host_uid := v_user_id; v_host_email := v_user_email; v_host_set := true;
          END IF;
        ELSE
          v_unmatched := array_append(v_unmatched, v_name);
        END IF;
      END LOOP;
    END IF;

    -- 5) Fallback host = fetched_by
    IF NOT v_host_set AND m.fetched_by IS NOT NULL THEN
      SELECT email INTO v_user_email FROM auth.users WHERE id = m.fetched_by;
      v_host_uid := m.fetched_by; v_host_email := v_user_email; v_host_set := true;
    END IF;

    -- 6) Update meetings (only NULL fields)
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
$$;

-- Unique index to prevent duplicate participants
CREATE UNIQUE INDEX IF NOT EXISTS meeting_participants_unique
  ON public.meeting_participants (meeting_id, user_id);

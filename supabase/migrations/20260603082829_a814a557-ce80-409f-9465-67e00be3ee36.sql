
CREATE OR REPLACE FUNCTION public.get_action_items_around(
  _meeting_id uuid,
  _days_back integer DEFAULT 7
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_admin boolean := public.has_role(v_uid, 'admin');
  v_email text;
  v_focus meetings%ROWTYPE;
  v_window_start timestamptz;
  v_window_end timestamptz;
  v_focus_json jsonb;
  v_related jsonb;
  v_combined jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = v_uid;

  SELECT * INTO v_focus FROM public.meetings WHERE id = _meeting_id;
  IF v_focus.id IS NULL THEN
    RETURN jsonb_build_object('error', 'meeting_not_found');
  END IF;

  -- Visibility check mirrors the meetings RLS policy
  IF NOT (
    v_is_admin
    OR v_focus.host_user_id = v_uid
    OR EXISTS (
      SELECT 1 FROM public.meeting_participants mp
      WHERE mp.meeting_id = v_focus.id AND mp.user_id = v_uid
    )
    OR (
      v_email IS NOT NULL AND (
        lower(coalesce(v_focus.host_email, '')) = lower(v_email)
        OR EXISTS (
          SELECT 1 FROM unnest(coalesce(v_focus.attendee_emails, ARRAY[]::text[])) ae
          WHERE lower(ae) = lower(v_email)
        )
      )
    )
  ) THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;

  v_window_end := coalesce(v_focus.meeting_date, v_focus.created_at);
  v_window_start := v_window_end - make_interval(days => greatest(_days_back, 1));

  v_focus_json := jsonb_build_object(
    'id', v_focus.id,
    'title', v_focus.title,
    'meeting_date', v_focus.meeting_date,
    'source', v_focus.source,
    'action_items', coalesce(v_focus.action_items, '[]'::jsonb),
    'summary', v_focus.summary
  );

  SELECT coalesce(jsonb_agg(row), '[]'::jsonb) INTO v_related
  FROM (
    SELECT jsonb_build_object(
      'id', m.id,
      'title', m.title,
      'meeting_date', m.meeting_date,
      'source', m.source,
      'action_items', coalesce(m.action_items, '[]'::jsonb)
    ) AS row
    FROM public.meetings m
    WHERE m.id <> v_focus.id
      AND coalesce(m.meeting_date, m.created_at) >= v_window_start
      AND coalesce(m.meeting_date, m.created_at) <  v_window_end
      AND m.action_items IS NOT NULL
      AND jsonb_typeof(m.action_items) = 'array'
      AND jsonb_array_length(m.action_items) > 0
      AND (
        v_is_admin
        OR m.host_user_id = v_uid
        OR EXISTS (
          SELECT 1 FROM public.meeting_participants mp
          WHERE mp.meeting_id = m.id AND mp.user_id = v_uid
        )
        OR (
          v_email IS NOT NULL AND (
            lower(coalesce(m.host_email, '')) = lower(v_email)
            OR EXISTS (
              SELECT 1 FROM unnest(coalesce(m.attendee_emails, ARRAY[]::text[])) ae
              WHERE lower(ae) = lower(v_email)
            )
          )
        )
      )
    ORDER BY coalesce(m.meeting_date, m.created_at) DESC
    LIMIT 25
  ) s;

  -- Combined flat list with source-meeting context
  WITH focus_items AS (
    SELECT jsonb_build_object(
      'meeting_id', v_focus.id,
      'meeting_title', v_focus.title,
      'meeting_date', v_focus.meeting_date,
      'is_focus', true,
      'item', item
    ) AS row
    FROM jsonb_array_elements(coalesce(v_focus.action_items, '[]'::jsonb)) item
  ),
  related_items AS (
    SELECT jsonb_build_object(
      'meeting_id', m.id,
      'meeting_title', m.title,
      'meeting_date', m.meeting_date,
      'is_focus', false,
      'item', item
    ) AS row
    FROM public.meetings m,
         jsonb_array_elements(coalesce(m.action_items, '[]'::jsonb)) item
    WHERE m.id <> v_focus.id
      AND coalesce(m.meeting_date, m.created_at) >= v_window_start
      AND coalesce(m.meeting_date, m.created_at) <  v_window_end
      AND (
        v_is_admin
        OR m.host_user_id = v_uid
        OR EXISTS (
          SELECT 1 FROM public.meeting_participants mp
          WHERE mp.meeting_id = m.id AND mp.user_id = v_uid
        )
        OR (
          v_email IS NOT NULL AND (
            lower(coalesce(m.host_email, '')) = lower(v_email)
            OR EXISTS (
              SELECT 1 FROM unnest(coalesce(m.attendee_emails, ARRAY[]::text[])) ae
              WHERE lower(ae) = lower(v_email)
            )
          )
        )
      )
  )
  SELECT coalesce(jsonb_agg(row), '[]'::jsonb)
    INTO v_combined
  FROM (
    SELECT row FROM focus_items
    UNION ALL
    SELECT row FROM related_items
  ) all_rows;

  RETURN jsonb_build_object(
    'focus_meeting', v_focus_json,
    'window_start', v_window_start,
    'window_end',   v_window_end,
    'days_back',    greatest(_days_back, 1),
    'related_meetings', v_related,
    'combined_action_items', v_combined
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_action_items_around(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_action_items_around(uuid, integer) TO service_role;

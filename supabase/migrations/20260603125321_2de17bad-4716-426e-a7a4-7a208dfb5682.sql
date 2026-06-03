CREATE OR REPLACE FUNCTION public.get_action_items_for_range(_from_date timestamptz, _to_date timestamptz)
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
  v_meetings jsonb;
  v_combined jsonb;
  v_total_items int := 0;
  v_meeting_count int := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF _from_date IS NULL OR _to_date IS NULL THEN
    RAISE EXCEPTION 'from_date and to_date are required';
  END IF;
  IF _to_date <= _from_date THEN
    RAISE EXCEPTION 'to_date must be after from_date';
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = v_uid;

  WITH visible AS (
    SELECT m.*
    FROM public.meetings m
    WHERE coalesce(m.meeting_date, m.created_at) >= _from_date
      AND coalesce(m.meeting_date, m.created_at) <  _to_date
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
  SELECT
    coalesce(jsonb_agg(
      jsonb_build_object(
        'id', v.id,
        'title', v.title,
        'meeting_date', v.meeting_date,
        'source', v.source,
        'summary', v.summary,
        'action_items', coalesce(v.action_items, '[]'::jsonb),
        'action_item_count', CASE
          WHEN v.action_items IS NOT NULL AND jsonb_typeof(v.action_items) = 'array'
            THEN jsonb_array_length(v.action_items)
          ELSE 0
        END
      )
      ORDER BY coalesce(v.meeting_date, v.created_at) DESC
    ), '[]'::jsonb),
    count(*)::int
  INTO v_meetings, v_meeting_count
  FROM visible v;

  WITH visible AS (
    SELECT m.*
    FROM public.meetings m
    WHERE coalesce(m.meeting_date, m.created_at) >= _from_date
      AND coalesce(m.meeting_date, m.created_at) <  _to_date
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
  SELECT coalesce(jsonb_agg(row ORDER BY (row->>'meeting_date') DESC NULLS LAST), '[]'::jsonb)
  INTO v_combined
  FROM (
    SELECT jsonb_build_object(
      'meeting_id', v.id,
      'meeting_title', v.title,
      'meeting_date', v.meeting_date,
      'source', v.source,
      'item', item
    ) AS row
    FROM visible v,
         jsonb_array_elements(coalesce(v.action_items, '[]'::jsonb)) item
    WHERE jsonb_typeof(coalesce(v.action_items, '[]'::jsonb)) = 'array'
  ) s;

  v_total_items := jsonb_array_length(coalesce(v_combined, '[]'::jsonb));

  RETURN jsonb_build_object(
    'from_date', _from_date,
    'to_date', _to_date,
    'meeting_count', v_meeting_count,
    'total_action_items', v_total_items,
    'meetings', v_meetings,
    'combined_action_items', v_combined
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_action_items_for_range(timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_action_items_for_range(timestamptz, timestamptz) TO service_role;
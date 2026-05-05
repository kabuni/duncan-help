
-- 1. Schema additions
ALTER TABLE public.meetings
  ADD COLUMN IF NOT EXISTS host_user_id uuid,
  ADD COLUMN IF NOT EXISTS host_email text,
  ADD COLUMN IF NOT EXISTS attendee_emails text[];

CREATE INDEX IF NOT EXISTS meetings_host_user_id_idx ON public.meetings(host_user_id);
CREATE INDEX IF NOT EXISTS meetings_fetched_by_idx ON public.meetings(fetched_by);
CREATE INDEX IF NOT EXISTS meetings_meeting_date_idx ON public.meetings(meeting_date DESC NULLS LAST);

-- 2. Participants table
CREATE TABLE IF NOT EXISTS public.meeting_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id uuid NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  user_id uuid,
  email text,
  role text DEFAULT 'attendee',
  match_confidence numeric DEFAULT 1.0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS meeting_participants_meeting_idx ON public.meeting_participants(meeting_id);
CREATE INDEX IF NOT EXISTS meeting_participants_user_idx ON public.meeting_participants(user_id);
CREATE INDEX IF NOT EXISTS meeting_participants_email_idx ON public.meeting_participants(lower(email));
CREATE UNIQUE INDEX IF NOT EXISTS meeting_participants_unique
  ON public.meeting_participants(meeting_id, COALESCE(user_id::text, ''), COALESCE(lower(email), ''));

ALTER TABLE public.meeting_participants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own participation" ON public.meeting_participants;
CREATE POLICY "Users can view own participation"
ON public.meeting_participants FOR SELECT
TO authenticated
USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins manage participants" ON public.meeting_participants;
CREATE POLICY "Admins manage participants"
ON public.meeting_participants FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 3. Tighten meetings RLS
DROP POLICY IF EXISTS "Authenticated users can view meetings" ON public.meetings;

CREATE POLICY "Users view their meetings"
ON public.meetings FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR host_user_id = auth.uid()
  OR fetched_by = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.meeting_participants mp
    WHERE mp.meeting_id = meetings.id AND mp.user_id = auth.uid()
  )
);

-- 4. Secure RPC
CREATE OR REPLACE FUNCTION public.get_my_meetings(_limit int DEFAULT 20, _scope text DEFAULT 'mine')
RETURNS SETOF public.meetings
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_admin boolean := public.has_role(v_uid, 'admin');
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
    RETURN QUERY
      SELECT m.* FROM public.meetings m
      WHERE m.host_user_id = v_uid
         OR m.fetched_by = v_uid
         OR EXISTS (
           SELECT 1 FROM public.meeting_participants mp
           WHERE mp.meeting_id = m.id AND mp.user_id = v_uid
         )
      ORDER BY COALESCE(m.meeting_date, m.created_at) DESC
      LIMIT _limit;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_meetings(int, text) TO authenticated;

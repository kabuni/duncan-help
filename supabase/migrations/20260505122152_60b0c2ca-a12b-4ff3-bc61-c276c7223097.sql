DROP POLICY IF EXISTS "Users view their meetings" ON public.meetings;

CREATE POLICY "Users view their meetings"
ON public.meetings
FOR SELECT
USING (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR host_user_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.meeting_participants mp
    WHERE mp.meeting_id = meetings.id AND mp.user_id = auth.uid()
  )
  OR (
    EXISTS (
      SELECT 1 FROM auth.users u
      WHERE u.id = auth.uid()
        AND (
          lower(u.email) = lower(meetings.host_email)
          OR lower(u.email) = ANY (
            SELECT lower(ae) FROM unnest(COALESCE(meetings.attendee_emails, ARRAY[]::text[])) ae
          )
        )
    )
  )
  OR (
    fetched_by = auth.uid()
    AND COALESCE(meeting_date, created_at) >= NOW() - INTERVAL '48 hours'
  )
);
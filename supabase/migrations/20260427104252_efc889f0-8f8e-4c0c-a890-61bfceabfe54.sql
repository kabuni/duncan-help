-- Allow admins (in addition to the CEO) to insert briefings and briefing jobs.

DROP POLICY IF EXISTS "CEO can insert briefings" ON public.ceo_briefings;
CREATE POLICY "CEO or admin can insert briefings"
ON public.ceo_briefings
FOR INSERT
TO authenticated
WITH CHECK (
  (auth.jwt() ->> 'email') = 'nimesh@kabuni.com'
  OR public.has_role(auth.uid(), 'admin')
);

DROP POLICY IF EXISTS "CEO can insert own briefing jobs" ON public.ceo_briefing_jobs;
CREATE POLICY "CEO or admin can insert own briefing jobs"
ON public.ceo_briefing_jobs
FOR INSERT
TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND (
    (auth.jwt() ->> 'email') = 'nimesh@kabuni.com'
    OR public.has_role(auth.uid(), 'admin')
  )
);
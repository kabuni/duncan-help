GRANT SELECT, INSERT, UPDATE, DELETE ON public.key_event_approvals TO authenticated;
GRANT ALL ON public.key_event_approvals TO service_role;

DROP POLICY IF EXISTS key_event_approvals_involved ON public.key_event_approvals;

CREATE POLICY "key_event_approvals_involved_select"
ON public.key_event_approvals
FOR SELECT
TO authenticated
USING (
  requested_by = auth.uid()
  OR approver_profile_id IN (
    SELECT profiles.id
    FROM public.profiles
    WHERE profiles.user_id = auth.uid()
  )
  OR public.has_role(auth.uid(), 'admin')
);

CREATE POLICY "key_event_approvals_requester_insert"
ON public.key_event_approvals
FOR INSERT
TO authenticated
WITH CHECK (
  requested_by = auth.uid()
  AND EXISTS (
    SELECT 1
    FROM public.key_events
    WHERE key_events.id = key_event_approvals.event_id
  )
);

CREATE POLICY "key_event_approvals_involved_update"
ON public.key_event_approvals
FOR UPDATE
TO authenticated
USING (
  requested_by = auth.uid()
  OR approver_profile_id IN (
    SELECT profiles.id
    FROM public.profiles
    WHERE profiles.user_id = auth.uid()
  )
  OR public.has_role(auth.uid(), 'admin')
)
WITH CHECK (
  requested_by = auth.uid()
  OR approver_profile_id IN (
    SELECT profiles.id
    FROM public.profiles
    WHERE profiles.user_id = auth.uid()
  )
  OR public.has_role(auth.uid(), 'admin')
);

CREATE POLICY "key_event_approvals_requester_delete"
ON public.key_event_approvals
FOR DELETE
TO authenticated
USING (
  requested_by = auth.uid()
  OR public.has_role(auth.uid(), 'admin')
);
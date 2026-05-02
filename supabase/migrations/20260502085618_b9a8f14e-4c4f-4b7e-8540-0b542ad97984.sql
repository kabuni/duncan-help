-- Restrict edit/delete on key_events strictly to the original creator (no admin override)
DROP POLICY IF EXISTS "Admins manage key events" ON public.key_events;

-- Keep admin SELECT visibility (already covered by "Authenticated can view key events")
-- Re-add admin INSERT capability so admins can still create events on behalf
CREATE POLICY "Admins can insert key events"
ON public.key_events
FOR INSERT
TO authenticated
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "key_events_involved_only" ON public.key_events;
CREATE POLICY "Authenticated users can view all key events"
  ON public.key_events FOR SELECT
  TO authenticated
  USING (true);
CREATE POLICY "Authenticated users can insert key events"
ON public.key_events FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE POLICY "Authenticated users can update key events"
ON public.key_events FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

CREATE POLICY "Authenticated users can delete key events"
ON public.key_events FOR DELETE
TO authenticated
USING (true);
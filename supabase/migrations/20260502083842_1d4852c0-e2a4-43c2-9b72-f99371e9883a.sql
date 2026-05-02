-- Track who created each event
ALTER TABLE public.key_events
ADD COLUMN IF NOT EXISTS created_by uuid;

CREATE INDEX IF NOT EXISTS idx_key_events_created_by ON public.key_events(created_by);

-- Allow any authenticated user to create events
CREATE POLICY "Authenticated can create key events"
ON public.key_events
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() IS NOT NULL);

-- Allow users to update events they created
CREATE POLICY "Users can update key events they created"
ON public.key_events
FOR UPDATE
TO authenticated
USING (created_by = auth.uid())
WITH CHECK (created_by = auth.uid());

-- Allow users to delete events they created
CREATE POLICY "Users can delete key events they created"
ON public.key_events
FOR DELETE
TO authenticated
USING (created_by = auth.uid());
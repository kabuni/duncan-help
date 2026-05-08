DROP POLICY IF EXISTS "Admins can delete cards" ON public.workstream_cards;
CREATE POLICY "Authenticated users can delete cards"
ON public.workstream_cards
FOR DELETE
TO authenticated
USING (true);
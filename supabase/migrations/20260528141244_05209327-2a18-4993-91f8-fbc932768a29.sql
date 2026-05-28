CREATE POLICY "Authenticated users can insert cards"
ON public.workstream_cards FOR INSERT TO authenticated
WITH CHECK (true);

CREATE POLICY "Authenticated users can update cards"
ON public.workstream_cards FOR UPDATE TO authenticated
USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can delete cards"
ON public.workstream_cards FOR DELETE TO authenticated
USING (true);
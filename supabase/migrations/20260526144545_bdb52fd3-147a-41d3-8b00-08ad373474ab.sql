
DROP POLICY IF EXISTS "workstream_cards_involved" ON public.workstream_cards;
CREATE POLICY "Authenticated users can view all cards"
  ON public.workstream_cards FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Project collaborators can view plan items" ON public.project_chat_plan_items;
CREATE POLICY "Authenticated users can view all plan items"
  ON public.project_chat_plan_items FOR SELECT
  TO authenticated
  USING (true);

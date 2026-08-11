ALTER TABLE public.workstream_cards
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'public';

ALTER TABLE public.workstream_cards
  DROP CONSTRAINT IF EXISTS workstream_cards_visibility_check;
ALTER TABLE public.workstream_cards
  ADD CONSTRAINT workstream_cards_visibility_check CHECK (visibility IN ('public','private'));

CREATE TABLE IF NOT EXISTS public.workstream_card_viewers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id uuid NOT NULL REFERENCES public.workstream_cards(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (card_id, user_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.workstream_card_viewers TO authenticated;
GRANT ALL ON public.workstream_card_viewers TO service_role;

ALTER TABLE public.workstream_card_viewers ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.can_view_workstream_card(_card_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workstream_cards c
    WHERE c.id = _card_id
      AND (
        COALESCE(c.visibility, 'public') = 'public'
        OR c.created_by = _user_id
        OR c.owner_id = _user_id
        OR EXISTS (SELECT 1 FROM public.workstream_card_viewers v WHERE v.card_id = c.id AND v.user_id = _user_id)
        OR EXISTS (SELECT 1 FROM public.workstream_card_assignees a WHERE a.card_id = c.id AND a.user_id = _user_id)
        OR public.has_role(_user_id, 'admin')
      )
  )
$$;

CREATE OR REPLACE FUNCTION public.can_manage_workstream_card(_card_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workstream_cards c
    WHERE c.id = _card_id
      AND (c.created_by = _user_id OR public.has_role(_user_id, 'admin'))
  )
$$;

DROP POLICY IF EXISTS "Viewers list readable by those who can see the card" ON public.workstream_card_viewers;
CREATE POLICY "Viewers list readable by those who can see the card"
ON public.workstream_card_viewers FOR SELECT TO authenticated
USING (public.can_view_workstream_card(card_id, auth.uid()));

DROP POLICY IF EXISTS "Card owner or admin manages viewers" ON public.workstream_card_viewers;
CREATE POLICY "Card owner or admin manages viewers"
ON public.workstream_card_viewers FOR ALL TO authenticated
USING (public.can_manage_workstream_card(card_id, auth.uid()))
WITH CHECK (public.can_manage_workstream_card(card_id, auth.uid()));

-- Cards: visibility-aware SELECT
DROP POLICY IF EXISTS "Authenticated users can view all cards" ON public.workstream_cards;
CREATE POLICY "Users can view permitted cards"
ON public.workstream_cards FOR SELECT TO authenticated
USING (
  COALESCE(visibility, 'public') = 'public'
  OR created_by = auth.uid()
  OR owner_id = auth.uid()
  OR EXISTS (SELECT 1 FROM public.workstream_card_viewers v WHERE v.card_id = workstream_cards.id AND v.user_id = auth.uid())
  OR EXISTS (SELECT 1 FROM public.workstream_card_assignees a WHERE a.card_id = workstream_cards.id AND a.user_id = auth.uid())
  OR public.has_role(auth.uid(), 'admin')
);

DROP POLICY IF EXISTS "Authenticated users can update cards" ON public.workstream_cards;
CREATE POLICY "Users can update permitted cards"
ON public.workstream_cards FOR UPDATE TO authenticated
USING (public.can_view_workstream_card(id, auth.uid()))
WITH CHECK (public.can_view_workstream_card(id, auth.uid()));

DROP POLICY IF EXISTS "Authenticated users can delete cards" ON public.workstream_cards;
CREATE POLICY "Users can delete permitted cards"
ON public.workstream_cards FOR DELETE TO authenticated
USING (public.can_view_workstream_card(id, auth.uid()));

-- Tasks follow card visibility
DROP POLICY IF EXISTS "Authenticated users can view tasks" ON public.workstream_tasks;
CREATE POLICY "Users can view tasks on permitted cards"
ON public.workstream_tasks FOR SELECT TO authenticated
USING (public.can_view_workstream_card(card_id, auth.uid()));

DROP POLICY IF EXISTS "Authenticated users can update tasks" ON public.workstream_tasks;
CREATE POLICY "Users can update tasks on permitted cards"
ON public.workstream_tasks FOR UPDATE TO authenticated
USING (public.can_view_workstream_card(card_id, auth.uid()));

DROP POLICY IF EXISTS "Authenticated users can delete tasks" ON public.workstream_tasks;
CREATE POLICY "Users can delete tasks on permitted cards"
ON public.workstream_tasks FOR DELETE TO authenticated
USING (public.can_view_workstream_card(card_id, auth.uid()));

DROP POLICY IF EXISTS "Authenticated users can create tasks" ON public.workstream_tasks;
CREATE POLICY "Users can create tasks on permitted cards"
ON public.workstream_tasks FOR INSERT TO authenticated
WITH CHECK (public.can_view_workstream_card(card_id, auth.uid()));

-- Card assignees follow card visibility for reads
DROP POLICY IF EXISTS "Authenticated users can view card assignees" ON public.workstream_card_assignees;
CREATE POLICY "Users can view assignees on permitted cards"
ON public.workstream_card_assignees FOR SELECT TO authenticated
USING (user_id = auth.uid() OR public.can_view_workstream_card(card_id, auth.uid()));

-- Comments follow card visibility
DROP POLICY IF EXISTS "Authenticated users can view comments" ON public.workstream_comments;
CREATE POLICY "Users can view comments on permitted cards"
ON public.workstream_comments FOR SELECT TO authenticated
USING (public.can_view_workstream_card(card_id, auth.uid()));

DROP POLICY IF EXISTS "Authenticated users can create comments" ON public.workstream_comments;
CREATE POLICY "Users can comment on permitted cards"
ON public.workstream_comments FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id AND public.can_view_workstream_card(card_id, auth.uid()));

-- Activity follows card visibility
DROP POLICY IF EXISTS "Authenticated users can view activity" ON public.workstream_activity;
CREATE POLICY "Users can view activity on permitted cards"
ON public.workstream_activity FOR SELECT TO authenticated
USING (public.can_view_workstream_card(card_id, auth.uid()));
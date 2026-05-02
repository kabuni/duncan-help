
CREATE TABLE public.project_chat_plan_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  chat_id UUID NOT NULL,
  project_id UUID NOT NULL,
  created_by UUID NOT NULL,
  group_title TEXT,
  title TEXT NOT NULL,
  notes TEXT,
  due_date DATE,
  assignee_profile_id UUID,
  status TEXT NOT NULL DEFAULT 'accepted' CHECK (status IN ('suggested','accepted','done','promoted')),
  position INTEGER NOT NULL DEFAULT 0,
  promoted_card_id UUID,
  promoted_task_id UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_pcpi_chat ON public.project_chat_plan_items(chat_id, position);
CREATE INDEX idx_pcpi_project ON public.project_chat_plan_items(project_id);

ALTER TABLE public.project_chat_plan_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Project collaborators can view plan items"
ON public.project_chat_plan_items
FOR SELECT
TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.project_members pm WHERE pm.project_id = project_chat_plan_items.project_id AND pm.user_id = auth.uid())
  OR EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_chat_plan_items.project_id AND p.user_id = auth.uid())
);

CREATE POLICY "Project collaborators can insert plan items"
ON public.project_chat_plan_items
FOR INSERT
TO authenticated
WITH CHECK (
  created_by = auth.uid()
  AND (
    EXISTS (SELECT 1 FROM public.project_members pm WHERE pm.project_id = project_chat_plan_items.project_id AND pm.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_chat_plan_items.project_id AND p.user_id = auth.uid())
  )
);

CREATE POLICY "Project collaborators can update plan items"
ON public.project_chat_plan_items
FOR UPDATE
TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.project_members pm WHERE pm.project_id = project_chat_plan_items.project_id AND pm.user_id = auth.uid())
  OR EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_chat_plan_items.project_id AND p.user_id = auth.uid())
);

CREATE POLICY "Project collaborators can delete plan items"
ON public.project_chat_plan_items
FOR DELETE
TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.project_members pm WHERE pm.project_id = project_chat_plan_items.project_id AND pm.user_id = auth.uid())
  OR EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_chat_plan_items.project_id AND p.user_id = auth.uid())
);

CREATE TRIGGER set_pcpi_updated_at
BEFORE UPDATE ON public.project_chat_plan_items
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

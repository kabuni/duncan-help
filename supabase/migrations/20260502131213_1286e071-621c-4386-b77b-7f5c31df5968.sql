-- 1. Remove orphaned plan items (chat deleted)
DELETE FROM public.project_chat_plan_items p
WHERE NOT EXISTS (SELECT 1 FROM public.project_chats c WHERE c.id = p.chat_id);

-- 2. Remove orphaned plan items (project deleted, defensive)
DELETE FROM public.project_chat_plan_items p
WHERE NOT EXISTS (SELECT 1 FROM public.projects pr WHERE pr.id = p.project_id);

-- 3. Add cascading FKs so this never recurs
ALTER TABLE public.project_chat_plan_items
  ADD CONSTRAINT project_chat_plan_items_chat_id_fkey
  FOREIGN KEY (chat_id) REFERENCES public.project_chats(id) ON DELETE CASCADE;

ALTER TABLE public.project_chat_plan_items
  ADD CONSTRAINT project_chat_plan_items_project_id_fkey
  FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;
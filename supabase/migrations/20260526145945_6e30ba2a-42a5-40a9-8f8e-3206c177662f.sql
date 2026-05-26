
-- Helper: can the user access this project?
CREATE OR REPLACE FUNCTION public.can_access_project(_project_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.projects p WHERE p.id = _project_id AND p.user_id = _user_id
  ) OR EXISTS (
    SELECT 1 FROM public.project_members m WHERE m.project_id = _project_id AND m.user_id = _user_id
  );
$$;

-- projects
DROP POLICY IF EXISTS "Authenticated users can view all projects" ON public.projects;
DROP POLICY IF EXISTS "Users can create own projects" ON public.projects;
DROP POLICY IF EXISTS "Owners can update own projects" ON public.projects;
DROP POLICY IF EXISTS "Owners can delete own projects" ON public.projects;

CREATE POLICY "Owners and collaborators can view projects"
ON public.projects FOR SELECT TO authenticated
USING (user_id = auth.uid() OR public.can_access_project(id, auth.uid()));

CREATE POLICY "Users can create own projects"
ON public.projects FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Owners can update own projects"
ON public.projects FOR UPDATE TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Owners can delete own projects"
ON public.projects FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- project_chats
DROP POLICY IF EXISTS "Authenticated users can view all project chats" ON public.project_chats;
CREATE POLICY "Project members can view chats"
ON public.project_chats FOR SELECT TO authenticated
USING (public.can_access_project(project_id, auth.uid()));

-- chat_messages
DROP POLICY IF EXISTS "Authenticated users can view all chat messages" ON public.chat_messages;
CREATE POLICY "Project members can view chat messages"
ON public.chat_messages FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.project_chats pc
  WHERE pc.id = chat_messages.chat_id
    AND public.can_access_project(pc.project_id, auth.uid())
));

-- project_files
DROP POLICY IF EXISTS "Authenticated users can view all project files" ON public.project_files;
CREATE POLICY "Project members can view files"
ON public.project_files FOR SELECT TO authenticated
USING (public.can_access_project(project_id, auth.uid()));

-- project_file_chunks
DROP POLICY IF EXISTS "Authenticated users can view all project file chunks" ON public.project_file_chunks;
CREATE POLICY "Project members can view file chunks"
ON public.project_file_chunks FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.project_files pf
  WHERE pf.id = project_file_chunks.file_id
    AND public.can_access_project(pf.project_id, auth.uid())
));

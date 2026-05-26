
-- Open read access to projects and related content for all authenticated users
DROP POLICY IF EXISTS projects_own_only ON public.projects;

CREATE POLICY "Authenticated users can view all projects"
ON public.projects FOR SELECT TO authenticated USING (true);

CREATE POLICY "Users can create own projects"
ON public.projects FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Owners can update own projects"
ON public.projects FOR UPDATE TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Owners can delete own projects"
ON public.projects FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- project_chats: open read
DROP POLICY IF EXISTS "Project collaborators can view chats" ON public.project_chats;
DROP POLICY IF EXISTS "Users can view own project chats" ON public.project_chats;
CREATE POLICY "Authenticated users can view all project chats"
ON public.project_chats FOR SELECT TO authenticated USING (true);

-- chat_messages: open read
DROP POLICY IF EXISTS "Project collaborators can view chat messages" ON public.chat_messages;
DROP POLICY IF EXISTS "Users can view own chat messages" ON public.chat_messages;
CREATE POLICY "Authenticated users can view all chat messages"
ON public.chat_messages FOR SELECT TO authenticated USING (true);

-- project_files: open read
DROP POLICY IF EXISTS "Users can view own project files" ON public.project_files;
CREATE POLICY "Authenticated users can view all project files"
ON public.project_files FOR SELECT TO authenticated USING (true);

-- project_file_chunks: open read (for RAG visibility)
DROP POLICY IF EXISTS "Users can view own project file chunks" ON public.project_file_chunks;
CREATE POLICY "Authenticated users can view all project file chunks"
ON public.project_file_chunks FOR SELECT TO authenticated USING (true);

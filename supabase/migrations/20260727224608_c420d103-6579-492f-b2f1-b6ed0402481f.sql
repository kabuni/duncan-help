
-- =========================================================
-- PROJECT TEAM CHAT (human-to-human, no AI involvement)
-- =========================================================

-- Messages
CREATE TABLE public.project_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content TEXT NOT NULL DEFAULT '',
  attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
  reply_to_id UUID REFERENCES public.project_messages(id) ON DELETE SET NULL,
  edited_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  deleted_by UUID REFERENCES auth.users(id),
  pinned_at TIMESTAMPTZ,
  pinned_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX project_messages_project_created_idx
  ON public.project_messages (project_id, created_at DESC);
CREATE INDEX project_messages_user_idx
  ON public.project_messages (user_id);
CREATE INDEX project_messages_pinned_idx
  ON public.project_messages (project_id, pinned_at DESC) WHERE pinned_at IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_messages TO authenticated;
GRANT ALL ON public.project_messages TO service_role;

ALTER TABLE public.project_messages ENABLE ROW LEVEL SECURITY;

-- Read: any project collaborator
CREATE POLICY "collab read project_messages"
  ON public.project_messages FOR SELECT TO authenticated
  USING (public.can_access_project(project_id, auth.uid()));

-- Insert: any collaborator, only as themselves
CREATE POLICY "collab insert project_messages"
  ON public.project_messages FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND public.can_access_project(project_id, auth.uid())
  );

-- Update: author edits own message, OR project owner / admin (moderation: pin, soft-delete)
CREATE POLICY "author or owner update project_messages"
  ON public.project_messages FOR UPDATE TO authenticated
  USING (
    user_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
    OR EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid())
  )
  WITH CHECK (
    user_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
    OR EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid())
  );

-- Hard delete: author or owner/admin (UI uses soft delete but allow hard delete for cleanup)
CREATE POLICY "author or owner delete project_messages"
  ON public.project_messages FOR DELETE TO authenticated
  USING (
    user_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
    OR EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid())
  );

-- Enforce edited_at auto-stamp and immutable core columns on UPDATE
CREATE OR REPLACE FUNCTION public.project_messages_before_update()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.project_id <> OLD.project_id THEN
    RAISE EXCEPTION 'project_id is immutable';
  END IF;
  IF NEW.user_id <> OLD.user_id THEN
    RAISE EXCEPTION 'user_id is immutable';
  END IF;
  IF NEW.created_at <> OLD.created_at THEN
    NEW.created_at := OLD.created_at;
  END IF;
  -- Auto-stamp edited_at when the author changes content
  IF NEW.user_id = COALESCE(auth.uid(), NEW.user_id)
     AND NEW.content IS DISTINCT FROM OLD.content
     AND NEW.deleted_at IS NULL
     AND OLD.deleted_at IS NULL THEN
    NEW.edited_at := now();
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER project_messages_before_update
  BEFORE UPDATE ON public.project_messages
  FOR EACH ROW EXECUTE FUNCTION public.project_messages_before_update();

-- Read receipts / unread tracking
CREATE TABLE public.project_message_reads (
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  last_read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_message_reads TO authenticated;
GRANT ALL ON public.project_message_reads TO service_role;

ALTER TABLE public.project_message_reads ENABLE ROW LEVEL SECURITY;

-- Any collaborator can read all rows for that project (needed for "seen by all" tick)
CREATE POLICY "collab read project_message_reads"
  ON public.project_message_reads FOR SELECT TO authenticated
  USING (public.can_access_project(project_id, auth.uid()));

-- Only the user themselves can upsert / update their own read cursor
CREATE POLICY "self upsert project_message_reads"
  ON public.project_message_reads FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND public.can_access_project(project_id, auth.uid())
  );

CREATE POLICY "self update project_message_reads"
  ON public.project_message_reads FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "self delete project_message_reads"
  ON public.project_message_reads FOR DELETE TO authenticated
  USING (user_id = auth.uid());

CREATE TRIGGER project_message_reads_updated_at
  BEFORE UPDATE ON public.project_message_reads
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.project_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.project_message_reads;
ALTER TABLE public.project_messages REPLICA IDENTITY FULL;
ALTER TABLE public.project_message_reads REPLICA IDENTITY FULL;

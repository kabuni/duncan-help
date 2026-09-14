ALTER TABLE public.project_messages
  ADD COLUMN IF NOT EXISTS author_type text NOT NULL DEFAULT 'user';

ALTER TABLE public.project_messages
  ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE public.project_messages
  DROP CONSTRAINT IF EXISTS project_messages_author_type_check;

ALTER TABLE public.project_messages
  ADD CONSTRAINT project_messages_author_type_check
  CHECK (author_type IN ('user','duncan') AND (author_type = 'duncan' OR user_id IS NOT NULL));
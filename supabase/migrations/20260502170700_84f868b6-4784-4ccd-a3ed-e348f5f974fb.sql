
ALTER TABLE public.workstream_task_comments ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE public.workstream_comments ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

DROP POLICY IF EXISTS "Users can update own task comments" ON public.workstream_task_comments;
CREATE POLICY "Users can update own task comments"
ON public.workstream_task_comments
FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own comments" ON public.workstream_comments;
CREATE POLICY "Users can update own comments"
ON public.workstream_comments
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

DROP TRIGGER IF EXISTS trg_workstream_task_comments_updated_at ON public.workstream_task_comments;
CREATE TRIGGER trg_workstream_task_comments_updated_at
BEFORE UPDATE ON public.workstream_task_comments
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_workstream_comments_updated_at ON public.workstream_comments;
CREATE TRIGGER trg_workstream_comments_updated_at
BEFORE UPDATE ON public.workstream_comments
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

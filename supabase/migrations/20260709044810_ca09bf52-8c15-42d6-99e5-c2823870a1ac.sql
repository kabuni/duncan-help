
ALTER TABLE public.meeting_requests
  ADD COLUMN IF NOT EXISTS user_id UUID;

-- Backfill Nimesh as owner of legacy rows
UPDATE public.meeting_requests
  SET user_id = '517bf518-6111-41b8-9ff0-1249f3055ec7'
  WHERE user_id IS NULL;

ALTER TABLE public.meeting_requests
  ALTER COLUMN user_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS meeting_requests_user_idx
  ON public.meeting_requests(user_id, created_at DESC);

-- Replace legacy admin-only policies with per-user scoping
DROP POLICY IF EXISTS "Admins can view meeting requests" ON public.meeting_requests;
DROP POLICY IF EXISTS "Admins can update meeting requests" ON public.meeting_requests;
DROP POLICY IF EXISTS "Users view own meeting requests" ON public.meeting_requests;
DROP POLICY IF EXISTS "Users update own meeting requests" ON public.meeting_requests;

CREATE POLICY "Users view own meeting requests"
  ON public.meeting_requests
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users update own meeting requests"
  ON public.meeting_requests
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

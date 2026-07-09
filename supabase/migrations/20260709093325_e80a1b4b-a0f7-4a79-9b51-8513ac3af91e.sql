
-- Add scope to google_drive_tokens to support both personal (per-user) and company (shared) drives
ALTER TABLE public.google_drive_tokens
  ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'company'
    CHECK (scope IN ('personal','company'));

-- Drop old singleton constraint (only one row overall) — we now allow one per (user, scope)
DROP INDEX IF EXISTS public.google_drive_tokens_singleton;

-- Uniqueness: one company token globally, one personal token per user
CREATE UNIQUE INDEX IF NOT EXISTS google_drive_tokens_company_singleton
  ON public.google_drive_tokens ((true)) WHERE scope = 'company';

CREATE UNIQUE INDEX IF NOT EXISTS google_drive_tokens_personal_per_user
  ON public.google_drive_tokens (connected_by) WHERE scope = 'personal';

-- Refresh RLS: users manage their own personal token; admins manage company
DROP POLICY IF EXISTS "Admins can manage drive tokens" ON public.google_drive_tokens;
DROP POLICY IF EXISTS "Authenticated users can view drive connection status" ON public.google_drive_tokens;

CREATE POLICY "Admins manage company drive token"
  ON public.google_drive_tokens
  FOR ALL
  USING (scope = 'company' AND public.has_role(auth.uid(), 'admin'))
  WITH CHECK (scope = 'company' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users manage their own personal drive token"
  ON public.google_drive_tokens
  FOR ALL
  USING (scope = 'personal' AND connected_by = auth.uid())
  WITH CHECK (scope = 'personal' AND connected_by = auth.uid());

CREATE POLICY "Authenticated can view drive connection status"
  ON public.google_drive_tokens
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

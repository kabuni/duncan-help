-- Phase 2: write-confirmation queue for chat-initiated write tools.
CREATE TYPE public.chat_write_status AS ENUM ('pending', 'confirmed', 'executed', 'cancelled', 'failed', 'expired');

CREATE TABLE public.chat_write_pending (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL,
  tool_args JSONB NOT NULL DEFAULT '{}'::jsonb,
  summary TEXT,
  idempotency_key TEXT NOT NULL,
  status public.chat_write_status NOT NULL DEFAULT 'pending',
  result JSONB,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '5 minutes'),
  executed_at TIMESTAMPTZ
);

CREATE INDEX idx_chat_write_pending_user ON public.chat_write_pending (user_id, created_at DESC);
CREATE UNIQUE INDEX idx_chat_write_pending_idem
  ON public.chat_write_pending (user_id, idempotency_key)
  WHERE status IN ('pending', 'confirmed', 'executed');

ALTER TABLE public.chat_write_pending ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own pending writes"
  ON public.chat_write_pending FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users update own pending writes"
  ON public.chat_write_pending FOR UPDATE
  USING (auth.uid() = user_id);

-- Edge functions use the service-role key; no INSERT policy needed for users.
CREATE POLICY "Service role manages all"
  ON public.chat_write_pending FOR ALL
  USING (false) WITH CHECK (false);
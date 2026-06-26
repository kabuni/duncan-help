
CREATE TABLE public.briefing_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  total_ms INTEGER,
  context_ms INTEGER,
  llm_ms INTEGER,
  status TEXT NOT NULL CHECK (status IN ('success','failed')),
  model TEXT,
  provider TEXT,
  attempts INTEGER NOT NULL DEFAULT 1,
  fallback_used BOOLEAN NOT NULL DEFAULT false,
  degraded BOOLEAN NOT NULL DEFAULT false,
  degraded_sources TEXT[] NOT NULL DEFAULT '{}',
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  error_code TEXT,
  error_message TEXT
);

GRANT SELECT ON public.briefing_runs TO authenticated;
GRANT ALL ON public.briefing_runs TO service_role;

ALTER TABLE public.briefing_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own briefing runs"
  ON public.briefing_runs FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all briefing runs"
  ON public.briefing_runs FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX briefing_runs_started_at_idx ON public.briefing_runs (started_at DESC);
CREATE INDEX briefing_runs_user_started_idx ON public.briefing_runs (user_id, started_at DESC);

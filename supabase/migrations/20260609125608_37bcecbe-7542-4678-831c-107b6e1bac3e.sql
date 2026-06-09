
CREATE TABLE public.correctness_violations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  turn_id TEXT,
  model TEXT,
  violation_count INTEGER NOT NULL DEFAULT 0,
  violation_kinds TEXT[] NOT NULL DEFAULT '{}',
  violation_details JSONB NOT NULL DEFAULT '[]'::jsonb,
  read_results_seen JSONB NOT NULL DEFAULT '[]'::jsonb,
  draft_preview TEXT
);

GRANT SELECT ON public.correctness_violations TO authenticated;
GRANT ALL ON public.correctness_violations TO service_role;

ALTER TABLE public.correctness_violations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view correctness violations"
  ON public.correctness_violations
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_correctness_violations_created_at
  ON public.correctness_violations (created_at DESC);

CREATE INDEX idx_correctness_violations_user_id
  ON public.correctness_violations (user_id);

CREATE INDEX idx_correctness_violations_kinds
  ON public.correctness_violations USING GIN (violation_kinds);

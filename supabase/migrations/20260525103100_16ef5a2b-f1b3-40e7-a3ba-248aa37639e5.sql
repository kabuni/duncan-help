
CREATE TABLE IF NOT EXISTS public.calendar_mutation_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid,
  tool_name text NOT NULL,
  event_id uuid,
  source text NOT NULL CHECK (source IN ('planner','google','unknown')),
  google_event_id text,
  calendar_id text,
  requested jsonb NOT NULL DEFAULT '{}'::jsonb,
  before_state jsonb,
  after_state jsonb,
  ok boolean NOT NULL DEFAULT false,
  verified boolean NOT NULL DEFAULT false,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cma_event ON public.calendar_mutation_audit (event_id);
CREATE INDEX IF NOT EXISTS idx_cma_created_at ON public.calendar_mutation_audit (created_at DESC);

ALTER TABLE public.calendar_mutation_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view calendar mutation audit"
  ON public.calendar_mutation_audit FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

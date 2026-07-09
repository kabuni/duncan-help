
-- 1. Extend feature_requests
ALTER TABLE public.feature_requests
  ADD COLUMN IF NOT EXISTS triage_status text NOT NULL DEFAULT 'new',
  ADD COLUMN IF NOT EXISTS clarification_round int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rice_reach numeric,
  ADD COLUMN IF NOT EXISTS rice_impact numeric,
  ADD COLUMN IF NOT EXISTS rice_confidence numeric,
  ADD COLUMN IF NOT EXISTS rice_effort numeric,
  ADD COLUMN IF NOT EXISTS rice_score numeric GENERATED ALWAYS AS (
    CASE WHEN rice_effort IS NULL OR rice_effort = 0 THEN NULL
         ELSE (COALESCE(rice_reach,0) * COALESCE(rice_impact,0) * COALESCE(rice_confidence,0)) / rice_effort
    END
  ) STORED,
  ADD COLUMN IF NOT EXISTS priority_band text,
  ADD COLUMN IF NOT EXISTS effort_band text,
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS refined_title text,
  ADD COLUMN IF NOT EXISTS problem_statement text,
  ADD COLUMN IF NOT EXISTS proposed_solution text,
  ADD COLUMN IF NOT EXISTS acceptance_criteria text,
  ADD COLUMN IF NOT EXISTS workstream_card_id uuid REFERENCES public.workstream_cards(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS email_thread_id text,
  ADD COLUMN IF NOT EXISTS last_agent_run_at timestamptz;

ALTER TABLE public.feature_requests DROP CONSTRAINT IF EXISTS feature_requests_triage_status_check;
ALTER TABLE public.feature_requests
  ADD CONSTRAINT feature_requests_triage_status_check
  CHECK (triage_status IN ('new','clarifying','triaged','filed','dismissed'));

CREATE INDEX IF NOT EXISTS idx_feature_requests_triage_status ON public.feature_requests(triage_status);
CREATE INDEX IF NOT EXISTS idx_feature_requests_rice_score ON public.feature_requests(rice_score DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_feature_requests_email_thread ON public.feature_requests(email_thread_id) WHERE email_thread_id IS NOT NULL;

-- 2. Message thread log
CREATE TABLE IF NOT EXISTS public.feature_request_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  feature_request_id uuid NOT NULL REFERENCES public.feature_requests(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('agent','user','system')),
  channel text NOT NULL CHECK (channel IN ('email','in_app','system')),
  body text NOT NULL,
  gmail_message_id text,
  gmail_thread_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.feature_request_messages TO authenticated;
GRANT ALL ON public.feature_request_messages TO service_role;

ALTER TABLE public.feature_request_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Requester can read own thread"
  ON public.feature_request_messages FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.feature_requests fr
      WHERE fr.id = feature_request_messages.feature_request_id
        AND fr.user_id = auth.uid()
    )
  );

CREATE POLICY "Admins can read all threads"
  ON public.feature_request_messages FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Requester can post replies in-app"
  ON public.feature_request_messages FOR INSERT
  TO authenticated
  WITH CHECK (
    role = 'user'
    AND channel = 'in_app'
    AND EXISTS (
      SELECT 1 FROM public.feature_requests fr
      WHERE fr.id = feature_request_messages.feature_request_id
        AND fr.user_id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS idx_feature_request_messages_fr ON public.feature_request_messages(feature_request_id, created_at);

-- 3. app_settings seeds
INSERT INTO public.app_settings(key, value)
VALUES
  ('feature_request_sender_email', to_jsonb('duncan@kabuni.com'::text)),
  ('feature_request_backlog_tag', to_jsonb('Product Backlog'::text)),
  ('feature_request_default_assignee', 'null'::jsonb)
ON CONFLICT (key) DO NOTHING;

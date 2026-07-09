
-- Rolling store of cleaned/redacted sent-email samples per user, tagged by
-- recipient domain so Duncan can pick the closest tone cluster when drafting.
CREATE TABLE public.gmail_style_samples (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  gmail_message_id TEXT NOT NULL,
  recipient_email TEXT,
  recipient_domain TEXT,
  subject TEXT,
  sample_text TEXT NOT NULL,
  word_count INTEGER,
  sent_at TIMESTAMPTZ,
  weight NUMERIC NOT NULL DEFAULT 1.0,
  source TEXT NOT NULL DEFAULT 'sent',   -- 'sent' | 'edit_correction'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX gmail_style_samples_user_msg_uidx
  ON public.gmail_style_samples(user_id, gmail_message_id);
CREATE INDEX gmail_style_samples_user_created_idx
  ON public.gmail_style_samples(user_id, created_at DESC);
CREATE INDEX gmail_style_samples_user_domain_idx
  ON public.gmail_style_samples(user_id, recipient_domain);

GRANT SELECT ON public.gmail_style_samples TO authenticated;
GRANT ALL ON public.gmail_style_samples TO service_role;

ALTER TABLE public.gmail_style_samples ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own style samples"
  ON public.gmail_style_samples
  FOR SELECT
  USING (auth.uid() = user_id);

-- Diff feedback: when the user edits a Duncan draft before sending, we store
-- the original and final so retraining can weight the correction higher.
CREATE TABLE public.gmail_draft_feedback (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  gmail_thread_id TEXT,
  gmail_draft_id TEXT,
  recipient_email TEXT,
  recipient_domain TEXT,
  original_draft TEXT NOT NULL,
  final_sent TEXT NOT NULL,
  outcome TEXT NOT NULL DEFAULT 'edited', -- 'sent_as_is' | 'edited' | 'discarded'
  edit_distance INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX gmail_draft_feedback_user_created_idx
  ON public.gmail_draft_feedback(user_id, created_at DESC);

GRANT SELECT, INSERT ON public.gmail_draft_feedback TO authenticated;
GRANT ALL ON public.gmail_draft_feedback TO service_role;

ALTER TABLE public.gmail_draft_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own draft feedback"
  ON public.gmail_draft_feedback
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own draft feedback"
  ON public.gmail_draft_feedback
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Track last incremental learning run per user (so the cron only pulls
-- new sent-mail since the last successful pass).
ALTER TABLE public.gmail_writing_profiles
  ADD COLUMN IF NOT EXISTS incremental_learn_cursor TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_incremental_run_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS per_recipient_style JSONB NOT NULL DEFAULT '{}'::jsonb;

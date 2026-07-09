
-- Per-sender trust ledger
CREATE TABLE public.gmail_sender_trust (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  sender_email TEXT NOT NULL,
  sender_domain TEXT,
  sends_approved INTEGER NOT NULL DEFAULT 0,
  sends_edited INTEGER NOT NULL DEFAULT 0,
  sends_rejected INTEGER NOT NULL DEFAULT 0,
  confidence NUMERIC NOT NULL DEFAULT 0,       -- 0–100
  auto_send_enabled BOOLEAN NOT NULL DEFAULT false,  -- computed by trigger + admin override
  force_trust BOOLEAN NOT NULL DEFAULT false,  -- user override: always auto-send
  force_review BOOLEAN NOT NULL DEFAULT false, -- user override: always require review
  last_updated TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX gmail_sender_trust_user_sender_uidx
  ON public.gmail_sender_trust(user_id, sender_email);
CREATE INDEX gmail_sender_trust_user_idx
  ON public.gmail_sender_trust(user_id);

GRANT SELECT, UPDATE ON public.gmail_sender_trust TO authenticated;
GRANT ALL ON public.gmail_sender_trust TO service_role;
ALTER TABLE public.gmail_sender_trust ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own trust" ON public.gmail_sender_trust
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users update own trust" ON public.gmail_sender_trust
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Pending approvals (in-doubt drafts awaiting user decision)
CREATE TABLE public.gmail_pending_approvals (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  gmail_message_id TEXT NOT NULL,
  gmail_thread_id TEXT NOT NULL,
  gmail_draft_id TEXT,
  sender_email TEXT NOT NULL,
  sender_name TEXT,
  subject TEXT,
  incoming_snippet TEXT,
  incoming_summary TEXT,
  proposed_reply TEXT NOT NULL,
  ai_confidence NUMERIC,        -- 0–100 self-scored
  risk_flags TEXT[] DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | sent | edited | discarded | expired
  final_reply TEXT,
  sent_message_id TEXT,
  decided_at TIMESTAMPTZ,
  decided_via TEXT,             -- 'bell' | 'slack' | 'email'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '3 days')
);
CREATE UNIQUE INDEX gmail_pending_approvals_msg_uidx
  ON public.gmail_pending_approvals(user_id, gmail_message_id);
CREATE INDEX gmail_pending_approvals_user_status_idx
  ON public.gmail_pending_approvals(user_id, status, created_at DESC);

GRANT SELECT, UPDATE ON public.gmail_pending_approvals TO authenticated;
GRANT ALL ON public.gmail_pending_approvals TO service_role;
ALTER TABLE public.gmail_pending_approvals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own approvals" ON public.gmail_pending_approvals
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users update own approvals" ON public.gmail_pending_approvals
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Auto-send outbox (delayed 5 min for undo)
CREATE TABLE public.gmail_auto_outbox (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  gmail_message_id TEXT NOT NULL,
  gmail_thread_id TEXT NOT NULL,
  sender_email TEXT NOT NULL,
  subject TEXT,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued', -- queued | sent | undone | failed
  send_after TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ,
  sent_message_id TEXT,
  undone_at TIMESTAMPTZ,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX gmail_auto_outbox_msg_uidx
  ON public.gmail_auto_outbox(user_id, gmail_message_id);
CREATE INDEX gmail_auto_outbox_pending_idx
  ON public.gmail_auto_outbox(status, send_after);

GRANT SELECT, UPDATE ON public.gmail_auto_outbox TO authenticated;
GRANT ALL ON public.gmail_auto_outbox TO service_role;
ALTER TABLE public.gmail_auto_outbox ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own outbox" ON public.gmail_auto_outbox
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users undo own outbox" ON public.gmail_auto_outbox
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Location + EA mode on profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS current_timezone TEXT,
  ADD COLUMN IF NOT EXISTS current_country TEXT,
  ADD COLUMN IF NOT EXISTS location_auto BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS ea_mode_enabled BOOLEAN NOT NULL DEFAULT false;

-- Auto-send tunables (defaults locked to user's answers: 90 / 10 / 300s)
ALTER TABLE public.gmail_writing_profiles
  ADD COLUMN IF NOT EXISTS auto_send_confidence_threshold INTEGER NOT NULL DEFAULT 90,
  ADD COLUMN IF NOT EXISTS auto_send_min_approved INTEGER NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS auto_send_undo_seconds INTEGER NOT NULL DEFAULT 300;

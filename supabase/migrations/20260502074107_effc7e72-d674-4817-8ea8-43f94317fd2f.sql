-- Approval status enum
DO $$ BEGIN
  CREATE TYPE public.event_approval_status AS ENUM ('pending', 'approved', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.key_event_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.key_events(id) ON DELETE CASCADE,
  approval_type TEXT NOT NULL,
  label TEXT,
  approver_profile_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  requested_by UUID NOT NULL,
  status public.event_approval_status NOT NULL DEFAULT 'pending',
  decision_note TEXT,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_key_event_approvals_event ON public.key_event_approvals(event_id);
CREATE INDEX IF NOT EXISTS idx_key_event_approvals_approver ON public.key_event_approvals(approver_profile_id);

ALTER TABLE public.key_event_approvals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view approvals"
  ON public.key_event_approvals FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Authenticated can create approvals"
  ON public.key_event_approvals FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = requested_by);

CREATE POLICY "Authenticated can update approvals"
  ON public.key_event_approvals FOR UPDATE
  TO authenticated USING (true);

CREATE POLICY "Requester or admin can delete approvals"
  ON public.key_event_approvals FOR DELETE
  TO authenticated USING (
    auth.uid() = requested_by OR public.has_role(auth.uid(), 'admin'::app_role)
  );

CREATE TRIGGER trg_key_event_approvals_updated
  BEFORE UPDATE ON public.key_event_approvals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
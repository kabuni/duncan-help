
CREATE TABLE public.workspace_admin_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  google_account_email TEXT NOT NULL UNIQUE,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  token_expiry TIMESTAMPTZ NOT NULL,
  scopes TEXT,
  customer_id TEXT,
  last_polled_at TIMESTAMPTZ,
  last_poll_status TEXT,
  last_poll_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspace_admin_tokens TO authenticated;
GRANT ALL ON public.workspace_admin_tokens TO service_role;
ALTER TABLE public.workspace_admin_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage workspace admin tokens"
  ON public.workspace_admin_tokens FOR ALL
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER update_workspace_admin_tokens_updated_at
  BEFORE UPDATE ON public.workspace_admin_tokens
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.workspace_welcome_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  google_user_id TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  full_name TEXT,
  workspace_created_at TIMESTAMPTZ,
  welcome_sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  send_status TEXT NOT NULL DEFAULT 'sent',
  error_message TEXT,
  gmail_message_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_workspace_welcome_log_email ON public.workspace_welcome_log(lower(email));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspace_welcome_log TO authenticated;
GRANT ALL ON public.workspace_welcome_log TO service_role;
ALTER TABLE public.workspace_welcome_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins view workspace welcome log"
  ON public.workspace_welcome_log FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins manage workspace welcome log"
  ON public.workspace_welcome_log FOR ALL
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

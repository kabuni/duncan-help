
-- Singleton Duncan Gmail tokens (mirrors duncan_calendar_tokens)
CREATE TABLE public.duncan_gmail_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  google_account_email TEXT NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  token_expiry TIMESTAMPTZ NOT NULL,
  scopes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.duncan_gmail_tokens ENABLE ROW LEVEL SECURITY;

-- No table policies: service role bypasses RLS; clients read status via RPC below.

CREATE TRIGGER duncan_gmail_tokens_set_updated_at
BEFORE UPDATE ON public.duncan_gmail_tokens
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.get_duncan_gmail_status()
RETURNS TABLE(
  connected BOOLEAN,
  google_account_email TEXT,
  scopes TEXT,
  last_updated TIMESTAMPTZ
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    true AS connected,
    t.google_account_email,
    t.scopes,
    t.updated_at AS last_updated
  FROM public.duncan_gmail_tokens t
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_duncan_gmail_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_duncan_gmail_status() TO authenticated;

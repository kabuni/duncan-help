CREATE TABLE public.google_analytics_tokens (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  token_expiry TIMESTAMP WITH TIME ZONE NOT NULL,
  account_id TEXT,
  property_id TEXT,
  property_name TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.google_analytics_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own Google Analytics connection"
ON public.google_analytics_tokens
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can remove their own Google Analytics connection"
ON public.google_analytics_tokens
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

CREATE TRIGGER update_google_analytics_tokens_updated_at
BEFORE UPDATE ON public.google_analytics_tokens
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
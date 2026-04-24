CREATE TABLE public.slack_connections (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE,
  access_token TEXT NOT NULL,
  team_id TEXT NOT NULL,
  team_name TEXT,
  authed_user_id TEXT,
  scope TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.slack_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own Slack connection"
ON public.slack_connections
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own Slack connection"
ON public.slack_connections
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own Slack connection"
ON public.slack_connections
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.update_slack_connections_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_slack_connections_updated_at
BEFORE UPDATE ON public.slack_connections
FOR EACH ROW
EXECUTE FUNCTION public.update_slack_connections_updated_at();
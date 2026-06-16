
-- Tokens (single shared connection)
CREATE TABLE public.instagram_tokens (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  page_id TEXT NOT NULL UNIQUE,
  ig_business_id TEXT NOT NULL,
  ig_username TEXT,
  page_access_token TEXT NOT NULL,
  scope TEXT,
  expires_at TIMESTAMPTZ,
  connected_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.instagram_tokens TO authenticated;
GRANT ALL ON public.instagram_tokens TO service_role;

ALTER TABLE public.instagram_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view instagram tokens"
ON public.instagram_tokens FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can manage instagram tokens"
ON public.instagram_tokens FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Snapshots (read by all authenticated users)
CREATE TABLE public.instagram_insights_snapshots (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ig_business_id TEXT NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  followers_count INTEGER,
  follows_count INTEGER,
  media_count INTEGER,
  followers_gained_28d INTEGER,
  reach_28d INTEGER,
  impressions_28d INTEGER,
  profile_views_28d INTEGER,
  website_clicks_28d INTEGER,
  reach_7d INTEGER,
  impressions_7d INTEGER,
  raw JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.instagram_insights_snapshots TO authenticated;
GRANT ALL ON public.instagram_insights_snapshots TO service_role;

ALTER TABLE public.instagram_insights_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view instagram snapshots"
ON public.instagram_insights_snapshots FOR SELECT TO authenticated
USING (true);

CREATE INDEX idx_ig_snap_captured ON public.instagram_insights_snapshots(captured_at DESC);

-- updated_at trigger
CREATE TRIGGER update_instagram_tokens_updated_at
BEFORE UPDATE ON public.instagram_tokens
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

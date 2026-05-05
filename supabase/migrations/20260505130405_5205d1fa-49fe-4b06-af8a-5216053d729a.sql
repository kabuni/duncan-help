
CREATE TABLE IF NOT EXISTS public.social_stats_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fetched_at timestamptz NOT NULL DEFAULT now(),
  source_message_id text,
  source_filename text,
  source_email_date timestamptz,
  account text NOT NULL,
  channel text,
  week_label text,
  week_start date,
  followers numeric,
  posts numeric,
  likes numeric,
  comments numeric,
  shares numeric,
  impressions numeric,
  engagement_rate numeric,
  prev_followers numeric,
  prev_posts numeric,
  prev_likes numeric,
  prev_comments numeric,
  prev_shares numeric,
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS social_stats_snapshots_fetched_at_idx
  ON public.social_stats_snapshots (fetched_at DESC);

CREATE INDEX IF NOT EXISTS social_stats_snapshots_account_idx
  ON public.social_stats_snapshots (account);

ALTER TABLE public.social_stats_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read social stats"
  ON public.social_stats_snapshots
  FOR SELECT
  TO authenticated
  USING (true);

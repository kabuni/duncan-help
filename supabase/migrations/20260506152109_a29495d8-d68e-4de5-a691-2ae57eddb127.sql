ALTER TABLE public.gmail_writing_profiles
  ADD COLUMN IF NOT EXISTS auto_draft_filter_mode text NOT NULL DEFAULT 'blacklist'
    CHECK (auto_draft_filter_mode IN ('blacklist', 'whitelist')),
  ADD COLUMN IF NOT EXISTS auto_draft_filter_list text[] NOT NULL DEFAULT '{}'::text[];
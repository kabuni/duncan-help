ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS meet_duncan_tour_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS dismissed_nudges text[] NOT NULL DEFAULT '{}';
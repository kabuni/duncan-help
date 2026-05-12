ALTER TABLE public.event_rsvps
  ADD COLUMN IF NOT EXISTS first_name TEXT,
  ADD COLUMN IF NOT EXISTS last_name TEXT,
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS organisation_type TEXT CHECK (organisation_type IN ('school','media','company','other')),
  ADD COLUMN IF NOT EXISTS organisation_name TEXT,
  ADD COLUMN IF NOT EXISTS state TEXT;
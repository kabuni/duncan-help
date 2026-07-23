
-- RYG enum
DO $$ BEGIN
  CREATE TYPE public.plan90_ryg AS ENUM ('green','amber','red');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Updates table
CREATE TABLE IF NOT EXISTS public.plan90_deliverable_updates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  deliverable_id UUID NOT NULL REFERENCES public.plan90_deliverables(id) ON DELETE CASCADE,
  author_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  author_name TEXT NOT NULL,
  message TEXT NOT NULL CHECK (length(btrim(message)) > 0),
  ryg public.plan90_ryg NOT NULL DEFAULT 'amber',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS plan90_deliverable_updates_deliverable_created_idx
  ON public.plan90_deliverable_updates (deliverable_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.plan90_deliverable_updates TO authenticated;
GRANT ALL ON public.plan90_deliverable_updates TO service_role;

ALTER TABLE public.plan90_deliverable_updates ENABLE ROW LEVEL SECURITY;

-- Read: any authenticated user (matches Plan90 read model)
CREATE POLICY "plan90_updates_read_authenticated"
  ON public.plan90_deliverable_updates FOR SELECT
  TO authenticated USING (true);

-- Insert: must be self
CREATE POLICY "plan90_updates_insert_self"
  ON public.plan90_deliverable_updates FOR INSERT
  TO authenticated WITH CHECK (author_id = auth.uid());

-- Update: only author, within 15 min
CREATE POLICY "plan90_updates_update_author_recent"
  ON public.plan90_deliverable_updates FOR UPDATE
  TO authenticated
  USING (author_id = auth.uid() AND created_at > now() - interval '15 minutes')
  WITH CHECK (author_id = auth.uid());

-- Delete: author within 15 min, OR admin anytime
CREATE POLICY "plan90_updates_delete_author_or_admin"
  ON public.plan90_deliverable_updates FOR DELETE
  TO authenticated
  USING (
    (author_id = auth.uid() AND created_at > now() - interval '15 minutes')
    OR public.has_role(auth.uid(), 'admin')
  );

-- updated_at trigger
DROP TRIGGER IF EXISTS plan90_updates_touch ON public.plan90_deliverable_updates;
CREATE TRIGGER plan90_updates_touch
  BEFORE UPDATE ON public.plan90_deliverable_updates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Realtime
ALTER TABLE public.plan90_deliverable_updates REPLICA IDENTITY FULL;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.plan90_deliverable_updates;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Backfill: import existing notes as a single amber "Imported note" entry
INSERT INTO public.plan90_deliverable_updates (deliverable_id, author_id, author_name, message, ryg, created_at)
SELECT d.id, NULL, 'Imported note', d.notes, 'amber', COALESCE(d.updated_at, now())
FROM public.plan90_deliverables d
WHERE d.notes IS NOT NULL
  AND length(btrim(d.notes)) > 0
  AND NOT EXISTS (
    SELECT 1 FROM public.plan90_deliverable_updates u WHERE u.deliverable_id = d.id
  );

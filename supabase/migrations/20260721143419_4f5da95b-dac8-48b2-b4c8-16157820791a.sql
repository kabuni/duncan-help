
-- 1. Additive: progress_percent column
ALTER TABLE public.plan90_deliverables
  ADD COLUMN IF NOT EXISTS progress_percent integer
  CHECK (progress_percent IS NULL OR (progress_percent >= 0 AND progress_percent <= 100));

-- 2. Backfill existing 31 rows from current status ONLY (do not fabricate)
UPDATE public.plan90_deliverables
   SET progress_percent = 100
 WHERE status = 'Completed' AND progress_percent IS DISTINCT FROM 100;

UPDATE public.plan90_deliverables
   SET progress_percent = 0
 WHERE status = 'Not Started' AND progress_percent IS NULL;
-- In Progress rows: leave NULL (unknown) so UI can flag "not yet updated"

-- 3. Bidirectional sync trigger: status <-> progress consistency
CREATE OR REPLACE FUNCTION public.plan90_sync_status_progress()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Status drives progress on terminal states
  IF NEW.status = 'Completed' THEN
    NEW.progress_percent := 100;
  ELSIF NEW.status = 'Not Started' THEN
    -- If moving to Not Started, reset progress to 0
    IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM 'Not Started' THEN
      NEW.progress_percent := 0;
    ELSIF NEW.progress_percent IS NULL THEN
      NEW.progress_percent := 0;
    END IF;
  ELSIF NEW.status = 'In Progress' THEN
    -- Coming back from Completed: force progress < 100 (require re-entry)
    IF TG_OP = 'UPDATE' AND OLD.status = 'Completed' AND COALESCE(NEW.progress_percent, 100) >= 100 THEN
      NEW.progress_percent := NULL; -- admin must supply a real value
    END IF;
  END IF;

  -- Progress 100 => auto-complete
  IF NEW.progress_percent = 100 AND NEW.status <> 'Completed' THEN
    NEW.status := 'Completed';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS plan90_sync_status_progress ON public.plan90_deliverables;
CREATE TRIGGER plan90_sync_status_progress
  BEFORE INSERT OR UPDATE ON public.plan90_deliverables
  FOR EACH ROW EXECUTE FUNCTION public.plan90_sync_status_progress();

-- 4. Tighten read security: explicitly revoke anon access (defence in depth)
REVOKE ALL ON public.plan90_workstreams FROM anon;
REVOKE ALL ON public.plan90_deliverables FROM anon;
REVOKE ALL ON public.plan90_attachments FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.plan90_workstreams TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.plan90_deliverables TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.plan90_attachments TO authenticated;
GRANT ALL ON public.plan90_workstreams TO service_role;
GRANT ALL ON public.plan90_deliverables TO service_role;
GRANT ALL ON public.plan90_attachments TO service_role;

-- 5. Storage: restrict SELECT on plan90-attachments to authenticated
DROP POLICY IF EXISTS "plan90 storage read" ON storage.objects;
CREATE POLICY "plan90 storage read authenticated"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'plan90-attachments');

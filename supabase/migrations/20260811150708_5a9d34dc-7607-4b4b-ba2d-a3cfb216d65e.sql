ALTER TABLE public.plan90_deliverables ADD COLUMN IF NOT EXISTS completed_at timestamptz;

CREATE OR REPLACE FUNCTION public.plan90_autoarchive_completed()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'Completed' THEN
    IF NEW.completed_at IS NULL THEN
      NEW.completed_at := now();
    END IF;
    NEW.archived := true;
  ELSIF TG_OP = 'UPDATE' AND OLD.status = 'Completed' AND NEW.status <> 'Completed' THEN
    NEW.completed_at := NULL;
    NEW.archived := false;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_plan90_autoarchive_completed ON public.plan90_deliverables;
CREATE TRIGGER trg_plan90_autoarchive_completed
BEFORE INSERT OR UPDATE OF status ON public.plan90_deliverables
FOR EACH ROW EXECUTE FUNCTION public.plan90_autoarchive_completed();

UPDATE public.plan90_deliverables
SET completed_at = COALESCE(completed_at, updated_at), archived = true
WHERE status = 'Completed';
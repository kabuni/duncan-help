-- Single source of truth: recompute total_score atomically inside the database
CREATE OR REPLACE FUNCTION public.recompute_candidate_total_score()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_values numeric := NEW.values_score;
  v_comp numeric := NEW.competency_score;
  v_interview numeric := NEW.interview_final_score;
  v_total numeric;
BEGIN
  IF v_interview IS NOT NULL AND v_values IS NOT NULL AND v_comp IS NOT NULL THEN
    v_total := ROUND(((v_values + v_comp + v_interview) / 3.0)::numeric, 1);
  ELSIF v_values IS NOT NULL AND v_comp IS NOT NULL THEN
    v_total := ROUND(((v_values + v_comp) / 2.0)::numeric, 1);
  ELSE
    v_total := NULL;
  END IF;

  NEW.total_score := v_total;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_recompute_total_score ON public.candidates;

CREATE TRIGGER trg_recompute_total_score
BEFORE INSERT OR UPDATE OF values_score, competency_score, interview_final_score
ON public.candidates
FOR EACH ROW
EXECUTE FUNCTION public.recompute_candidate_total_score();

-- Backfill: force trigger to recompute every row using a no-op update
UPDATE public.candidates
SET values_score = values_score
WHERE values_score IS NOT NULL OR competency_score IS NOT NULL OR interview_final_score IS NOT NULL;
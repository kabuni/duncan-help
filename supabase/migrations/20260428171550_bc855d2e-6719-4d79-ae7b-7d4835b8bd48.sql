ALTER TABLE public.candidates
  ADD COLUMN IF NOT EXISTS is_score_locked boolean NOT NULL DEFAULT false;

ALTER TABLE public.candidates
  ADD COLUMN IF NOT EXISTS cv_hash text;

CREATE INDEX IF NOT EXISTS idx_candidates_cv_hash_role
  ON public.candidates (cv_hash, job_role_id)
  WHERE cv_hash IS NOT NULL;

UPDATE public.candidates
SET is_score_locked = true
WHERE status = 'fully_scored'
  AND is_score_locked = false;

COMMENT ON COLUMN public.candidates.is_score_locked IS
  'Write-once lock. Set to true after both values_score and competency_score are populated. Scoring functions skip locked rows unless force=true.';

COMMENT ON COLUMN public.candidates.cv_hash IS
  'SHA-256 of extracted CV text. Used to short-circuit re-scoring when the same CV is uploaded again for the same role.';

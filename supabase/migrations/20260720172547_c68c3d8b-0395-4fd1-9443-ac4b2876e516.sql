ALTER TABLE public.candidates
ADD COLUMN IF NOT EXISTS is_portfolio_only BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.candidates.is_portfolio_only IS
'When true, competency scoring uses evidence-normalized methodology: only competencies with demonstrated/partially_demonstrated evidence contribute to competency_score; not_demonstrated/inaccessible are excluded from the denominator. See scoring_details.portfolio_meta for coverage.';
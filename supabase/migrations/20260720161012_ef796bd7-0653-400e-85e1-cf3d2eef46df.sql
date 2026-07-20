
ALTER TABLE public.candidates
  ADD COLUMN IF NOT EXISTS linkedin_url text,
  ADD COLUMN IF NOT EXISTS portfolio_url text,
  ADD COLUMN IF NOT EXISTS website_url text,
  ADD COLUMN IF NOT EXISTS source text;

COMMENT ON COLUMN public.candidates.linkedin_url IS 'Candidate LinkedIn profile URL (used when candidate is sourced from a recruiter deck/portfolio rather than a CV).';
COMMENT ON COLUMN public.candidates.portfolio_url IS 'Primary portfolio URL (esp. for UX/UI/product design candidates).';
COMMENT ON COLUMN public.candidates.website_url IS 'Personal or secondary website URL.';
COMMENT ON COLUMN public.candidates.source IS 'Origin of the candidate: gmail_cv, recruiter_deck, manual, etc.';

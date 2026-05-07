ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS onboarding_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS onboarding_step text NOT NULL DEFAULT 'welcome';

UPDATE public.profiles
   SET onboarding_completed_at = COALESCE(onboarding_completed_at, now()),
       onboarding_step = 'done'
 WHERE approval_status = 'approved'
   AND onboarding_completed_at IS NULL;
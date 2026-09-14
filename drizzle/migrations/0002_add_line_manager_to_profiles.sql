ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS line_manager_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_line_manager ON public.profiles(line_manager_profile_id);

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_line_manager_not_self;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_line_manager_not_self
  CHECK (line_manager_profile_id IS NULL OR line_manager_profile_id <> id);

-- Resolve the CURRENT line manager for an employee (by auth user id).
CREATE OR REPLACE FUNCTION public.get_line_manager_profile_id(_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.line_manager_profile_id
  FROM public.profiles p
  WHERE p.user_id = _user_id
$$;
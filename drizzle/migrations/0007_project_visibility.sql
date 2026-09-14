ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'private';

ALTER TABLE public.projects
  DROP CONSTRAINT IF EXISTS projects_visibility_check;
ALTER TABLE public.projects
  ADD CONSTRAINT projects_visibility_check CHECK (visibility IN ('public','private'));

CREATE OR REPLACE FUNCTION public.can_access_project(_project_id uuid, _user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = _project_id
      AND (p.user_id = _user_id OR p.visibility = 'public')
  ) OR EXISTS (
    SELECT 1 FROM public.project_members m WHERE m.project_id = _project_id AND m.user_id = _user_id
  );
$function$;

DROP POLICY IF EXISTS "Project members can view collaborator rows" ON public.project_members;
CREATE POLICY "Project viewers can view collaborator rows"
ON public.project_members
FOR SELECT
TO authenticated
USING (public.can_access_project(project_id, auth.uid()));
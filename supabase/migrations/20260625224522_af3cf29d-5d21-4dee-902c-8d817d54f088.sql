-- Allow project owners and any existing member to see the full collaborator list.
-- Previously the SELECT policy only matched rows where the caller was the adder
-- or the row's own user, so collaborators couldn't see their teammates.

CREATE OR REPLACE FUNCTION public.is_project_member(_project_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = _project_id AND p.user_id = _user_id
  ) OR EXISTS (
    SELECT 1 FROM public.project_members pm
    WHERE pm.project_id = _project_id AND pm.user_id = _user_id
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_project_member(uuid, uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "Project owners can view collaborator rows" ON public.project_members;

CREATE POLICY "Project members can view collaborator rows"
ON public.project_members
FOR SELECT
TO authenticated
USING (public.is_project_member(project_id, auth.uid()));

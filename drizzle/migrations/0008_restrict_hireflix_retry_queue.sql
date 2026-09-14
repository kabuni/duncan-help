-- Hireflix retry queue drives privileged backend operations (creating/deleting
-- Hireflix positions, sending candidate invites). Ordinary authenticated users
-- must not be able to enqueue or read these entries.
DROP POLICY IF EXISTS "Authenticated users can enqueue hireflix retries" ON public.hireflix_retry_queue;
DROP POLICY IF EXISTS "Authenticated can view retry queue" ON public.hireflix_retry_queue;

CREATE POLICY "Recruitment admins can view retry queue"
ON public.hireflix_retry_queue
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_role(auth.uid(), 'recruitment_admin'::app_role)
);

REVOKE INSERT, UPDATE, DELETE ON public.hireflix_retry_queue FROM authenticated;
GRANT SELECT ON public.hireflix_retry_queue TO authenticated;
GRANT ALL ON public.hireflix_retry_queue TO service_role;
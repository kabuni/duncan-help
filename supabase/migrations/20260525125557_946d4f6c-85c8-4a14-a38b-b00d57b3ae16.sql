-- Phase 7: allow each user to read their own calendar mutation audit rows.
-- Admin read policy already exists; this adds a per-user read policy.
CREATE POLICY "Users can view their own calendar mutation audit"
ON public.calendar_mutation_audit
FOR SELECT
TO authenticated
USING (actor_user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_cma_actor_created_at
  ON public.calendar_mutation_audit (actor_user_id, created_at DESC);
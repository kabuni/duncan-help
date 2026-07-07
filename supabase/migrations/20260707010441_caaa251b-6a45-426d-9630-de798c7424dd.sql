
-- ============================================================
-- Phase 2: Onboarding Plan Revision History
-- ============================================================

-- 1. Extend approval_kind enum
ALTER TYPE public.approval_kind ADD VALUE IF NOT EXISTS 'onboarding_plan';

-- 2. Core table
CREATE TABLE public.onboarding_plan_revisions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id        uuid NOT NULL REFERENCES public.candidates(id) ON DELETE CASCADE,
  onboarding_run_id   uuid REFERENCES public.onboarding_runs(id) ON DELETE SET NULL,
  revision_number     integer NOT NULL,
  plan                jsonb NOT NULL,
  status              text NOT NULL DEFAULT 'pending_review',
  authored_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  authored_source     text NOT NULL,
  change_summary      text,
  diff_from_previous  jsonb,
  approver_user_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decision_note       text,
  decided_at          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT opr_status_chk CHECK (status IN ('pending_review','approved','changes_requested','rejected','superseded')),
  CONSTRAINT opr_source_chk CHECK (authored_source IN ('ai_draft','ai_draft_backfill','human_edit')),
  CONSTRAINT opr_revnum_chk CHECK (revision_number >= 1),
  CONSTRAINT opr_plan_obj_chk CHECK (jsonb_typeof(plan) = 'object'),
  CONSTRAINT opr_decided_chk CHECK ((status IN ('approved','rejected')) = (decided_at IS NOT NULL)),
  CONSTRAINT opr_candidate_rev_unique UNIQUE (candidate_id, revision_number)
);

-- 3. Grants
GRANT SELECT, INSERT, UPDATE ON public.onboarding_plan_revisions TO authenticated;
GRANT ALL ON public.onboarding_plan_revisions TO service_role;

-- 4. RLS
ALTER TABLE public.onboarding_plan_revisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view plan revisions"
  ON public.onboarding_plan_revisions FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Recruitment admins manage plan revisions"
  ON public.onboarding_plan_revisions FOR INSERT TO authenticated
  WITH CHECK (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'recruitment_admin'::app_role)
  );

CREATE POLICY "Recruitment admins update plan revisions"
  ON public.onboarding_plan_revisions FOR UPDATE TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'recruitment_admin'::app_role)
  )
  WITH CHECK (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'recruitment_admin'::app_role)
  );

-- No DELETE policy: append-only. Trigger below also blocks service_role deletes.

-- 5. Indexes
CREATE INDEX idx_opr_candidate_latest
  ON public.onboarding_plan_revisions (candidate_id, revision_number DESC);

CREATE INDEX idx_opr_status_pending
  ON public.onboarding_plan_revisions (status, created_at DESC)
  WHERE status IN ('pending_review','changes_requested');

CREATE INDEX idx_opr_authored_by
  ON public.onboarding_plan_revisions (authored_by)
  WHERE authored_by IS NOT NULL;

CREATE INDEX idx_opr_onboarding_run
  ON public.onboarding_plan_revisions (onboarding_run_id);

CREATE UNIQUE INDEX one_approved_per_candidate
  ON public.onboarding_plan_revisions (candidate_id)
  WHERE status = 'approved';

-- 6. updated_at trigger
CREATE TRIGGER opr_updated_at
  BEFORE UPDATE ON public.onboarding_plan_revisions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- 7. ENFORCEMENT TRIGGERS
-- ============================================================

-- 7a. Assign revision_number + compute diff_from_previous on insert
CREATE OR REPLACE FUNCTION public.assign_revision_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  next_num int;
  prev_plan jsonb;
  changed_sections text[] := ARRAY[]::text[];
  k text;
BEGIN
  -- Advisory lock per candidate to serialise revision_number assignment
  PERFORM pg_advisory_xact_lock(hashtext('onboarding_plan_rev:' || NEW.candidate_id::text));

  IF NEW.revision_number IS NULL OR NEW.revision_number = 0 THEN
    SELECT COALESCE(MAX(revision_number), 0) + 1
      INTO next_num
      FROM public.onboarding_plan_revisions
     WHERE candidate_id = NEW.candidate_id;
    NEW.revision_number := next_num;
  END IF;

  -- Compute diff_from_previous when not explicitly provided
  IF NEW.diff_from_previous IS NULL AND NEW.revision_number > 1 THEN
    SELECT plan INTO prev_plan
      FROM public.onboarding_plan_revisions
     WHERE candidate_id = NEW.candidate_id
       AND revision_number = NEW.revision_number - 1;

    IF prev_plan IS NOT NULL THEN
      FOREACH k IN ARRAY ARRAY['days_30','days_60','days_90'] LOOP
        IF (prev_plan -> k) IS DISTINCT FROM (NEW.plan -> k) THEN
          changed_sections := array_append(changed_sections, k);
        END IF;
      END LOOP;
      NEW.diff_from_previous := jsonb_build_object(
        'previous_plan', prev_plan,
        'sections_changed', to_jsonb(changed_sections)
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER opr_assign_revision_number
  BEFORE INSERT ON public.onboarding_plan_revisions
  FOR EACH ROW EXECUTE FUNCTION public.assign_revision_number();

-- 7b. Immutability on approved/rejected/superseded; plan field always immutable
CREATE OR REPLACE FUNCTION public.enforce_revision_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- plan JSON is immutable once persisted
  IF NEW.plan IS DISTINCT FROM OLD.plan THEN
    RAISE EXCEPTION 'onboarding_plan_revisions.plan is immutable (create a new revision instead)';
  END IF;

  -- revision_number, candidate_id, authored_by, authored_source, created_at are immutable
  IF NEW.revision_number    <> OLD.revision_number    THEN RAISE EXCEPTION 'revision_number is immutable'; END IF;
  IF NEW.candidate_id       <> OLD.candidate_id       THEN RAISE EXCEPTION 'candidate_id is immutable'; END IF;
  IF NEW.authored_source    <> OLD.authored_source    THEN RAISE EXCEPTION 'authored_source is immutable'; END IF;
  IF NEW.created_at         <> OLD.created_at         THEN RAISE EXCEPTION 'created_at is immutable'; END IF;

  -- Decisions are immutable once made
  IF OLD.decided_at IS NOT NULL THEN
    IF NEW.status           IS DISTINCT FROM OLD.status           THEN RAISE EXCEPTION 'status is immutable once decided'; END IF;
    IF NEW.decision_note    IS DISTINCT FROM OLD.decision_note    THEN RAISE EXCEPTION 'decision_note is immutable once decided'; END IF;
    IF NEW.decided_at       IS DISTINCT FROM OLD.decided_at       THEN RAISE EXCEPTION 'decided_at is immutable once decided'; END IF;
    IF NEW.approver_user_id IS DISTINCT FROM OLD.approver_user_id THEN RAISE EXCEPTION 'approver_user_id is immutable once decided'; END IF;
  END IF;

  -- Superseded is set by the system only via allowed transitions
  IF OLD.status = 'superseded' AND NEW.status <> 'superseded' THEN
    RAISE EXCEPTION 'superseded revisions cannot be reactivated';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER opr_enforce_immutability
  BEFORE UPDATE ON public.onboarding_plan_revisions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_revision_immutability();

-- 7c. Block deletes entirely
CREATE OR REPLACE FUNCTION public.block_revision_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'onboarding_plan_revisions is append-only — deletes are not permitted';
END;
$$;

CREATE TRIGGER opr_block_delete
  BEFORE DELETE ON public.onboarding_plan_revisions
  FOR EACH ROW EXECUTE FUNCTION public.block_revision_delete();

-- ============================================================
-- 8. Supersede older revisions when a new one is inserted
-- ============================================================
CREATE OR REPLACE FUNCTION public.supersede_prior_revisions()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Mark any prior non-terminal (pending/changes_requested) revisions as superseded.
  -- Approved/rejected prior revisions remain in their terminal state (still auditable).
  UPDATE public.onboarding_plan_revisions
     SET status = 'superseded',
         updated_at = now()
   WHERE candidate_id = NEW.candidate_id
     AND id <> NEW.id
     AND status IN ('pending_review','changes_requested');

  -- Cancel their pending approval-inbox rows
  UPDATE public.approvals
     SET status = 'cancelled',
         decision_note = COALESCE(decision_note, 'Superseded by revision ' || NEW.revision_number),
         decided_at = now(),
         updated_at = now()
   WHERE source_table = 'onboarding_plan_revisions'
     AND status = 'pending'
     AND source_id IN (
       SELECT id FROM public.onboarding_plan_revisions
        WHERE candidate_id = NEW.candidate_id AND id <> NEW.id
     );

  RETURN NEW;
END;
$$;

CREATE TRIGGER opr_supersede_prior
  AFTER INSERT ON public.onboarding_plan_revisions
  FOR EACH ROW
  WHEN (NEW.status = 'pending_review')
  EXECUTE FUNCTION public.supersede_prior_revisions();

-- ============================================================
-- 9. Sync revision → approvals inbox
-- ============================================================
CREATE OR REPLACE FUNCTION public.sync_onboarding_plan_to_inbox()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cand_name text;
  hm_id uuid;
  configured_approver uuid;
  approver uuid;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status = 'pending_review' THEN
    SELECT name, hiring_manager_id INTO cand_name, hm_id
      FROM public.candidates WHERE id = NEW.candidate_id;

    SELECT NULLIF(value #>> '{}', '')::uuid INTO configured_approver
      FROM public.app_settings WHERE key = 'onboarding_plan_approver_user_id';

    approver := COALESCE(configured_approver, hm_id);

    INSERT INTO public.approvals (
      kind, source_table, source_id, title, summary,
      status, requested_by, approver_user_id, link_path
    ) VALUES (
      'onboarding_plan',
      'onboarding_plan_revisions',
      NEW.id,
      'Onboarding plan review — ' || COALESCE(cand_name, 'candidate') || ' (v' || NEW.revision_number || ')',
      COALESCE(NEW.change_summary, 'Review the 30/60/90 plan for this new hire.'),
      'pending',
      NEW.authored_by,
      approver,
      '/recruitment?candidate=' || NEW.candidate_id::text || '&plan=' || NEW.id::text
    );
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.decided_at IS NOT NULL AND OLD.decided_at IS NULL THEN
    UPDATE public.approvals
       SET status = CASE NEW.status
             WHEN 'approved' THEN 'approved'::approval_status
             WHEN 'rejected' THEN 'rejected'::approval_status
             WHEN 'changes_requested' THEN 'changes_requested'::approval_status
             ELSE status
           END,
           decision_note = NEW.decision_note,
           decided_at = NEW.decided_at,
           updated_at = now()
     WHERE source_table = 'onboarding_plan_revisions'
       AND source_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER opr_sync_inbox_insert
  AFTER INSERT ON public.onboarding_plan_revisions
  FOR EACH ROW EXECUTE FUNCTION public.sync_onboarding_plan_to_inbox();

CREATE TRIGGER opr_sync_inbox_update
  AFTER UPDATE ON public.onboarding_plan_revisions
  FOR EACH ROW EXECUTE FUNCTION public.sync_onboarding_plan_to_inbox();

-- ============================================================
-- 10. Sync approved plan back to onboarding_runs.plan_30_60_90
--     (keeps backward compatibility with Daily Briefing + existing UI)
-- ============================================================
CREATE OR REPLACE FUNCTION public.sync_approved_plan_to_run()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'approved' AND (OLD.status IS DISTINCT FROM 'approved') THEN
    UPDATE public.onboarding_runs
       SET plan_30_60_90 = NEW.plan,
           updated_at = now()
     WHERE candidate_id = NEW.candidate_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER opr_sync_plan_to_run
  AFTER UPDATE ON public.onboarding_plan_revisions
  FOR EACH ROW EXECUTE FUNCTION public.sync_approved_plan_to_run();

-- ============================================================
-- 11. BACKFILL — every existing onboarding_runs.plan_30_60_90 becomes revision 1 approved
-- ============================================================
INSERT INTO public.onboarding_plan_revisions (
  candidate_id, onboarding_run_id, revision_number, plan,
  status, authored_by, authored_source, change_summary,
  decided_at, created_at, updated_at
)
SELECT
  r.candidate_id,
  r.id,
  1,
  r.plan_30_60_90,
  'approved',
  NULL,
  'ai_draft_backfill',
  'Backfilled from legacy onboarding_runs.plan_30_60_90',
  r.created_at,
  r.created_at,
  now()
FROM public.onboarding_runs r
WHERE r.plan_30_60_90 IS NOT NULL
  AND jsonb_typeof(r.plan_30_60_90) = 'object'
  AND NOT EXISTS (
    SELECT 1 FROM public.onboarding_plan_revisions x
     WHERE x.candidate_id = r.candidate_id
  );

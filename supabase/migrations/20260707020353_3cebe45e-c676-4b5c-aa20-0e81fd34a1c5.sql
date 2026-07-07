
-- ============================================================================
-- 1) FK: RESTRICT deletes (instead of CASCADE) so audit trail can't be lost.
-- ============================================================================
ALTER TABLE public.onboarding_plan_revisions
  DROP CONSTRAINT onboarding_plan_revisions_candidate_id_fkey;

-- We intentionally keep candidate_id NOT NULL, but allow "purge" to detach
-- (set NULL) via a controlled function. To do that, temporarily relax NOT NULL.
ALTER TABLE public.onboarding_plan_revisions
  ALTER COLUMN candidate_id DROP NOT NULL;

ALTER TABLE public.onboarding_plan_revisions
  ADD CONSTRAINT onboarding_plan_revisions_candidate_id_fkey
  FOREIGN KEY (candidate_id) REFERENCES public.candidates(id) ON DELETE SET NULL;

-- Add a purge marker so detached revisions are distinguishable
ALTER TABLE public.onboarding_plan_revisions
  ADD COLUMN IF NOT EXISTS purged_at timestamptz;

-- ============================================================================
-- 2) Append-only guard: block DELETE unless GUC unlocks it (admin purge only).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.block_revision_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF COALESCE(current_setting('app.allow_revision_purge', true), '') = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'onboarding_plan_revisions is append-only — use admin_purge_candidate() to remove candidates';
END;
$function$;

-- ============================================================================
-- 3) Admin-only purge function
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_purge_candidate(_candidate_id uuid, _reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_rev_count int;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'Only global admins can purge candidates';
  END IF;

  -- Preserve revision history: detach by nulling candidate_id and marking purged.
  UPDATE public.onboarding_plan_revisions
     SET candidate_id = NULL,
         purged_at = now(),
         decision_note = COALESCE(decision_note, '') ||
           CASE WHEN _reason IS NOT NULL THEN E'\n[purged: ' || _reason || ']' ELSE E'\n[purged]' END
   WHERE candidate_id = _candidate_id
  RETURNING 1 INTO v_rev_count;

  GET DIAGNOSTICS v_rev_count = ROW_COUNT;

  -- Cancel any pending approval-inbox rows tied to those revisions.
  UPDATE public.approvals
     SET status = 'cancelled',
         decision_note = COALESCE(decision_note, 'Candidate purged'),
         decided_at = now(),
         updated_at = now()
   WHERE source_table = 'onboarding_plan_revisions'
     AND status = 'pending'
     AND source_id IN (
       SELECT id FROM public.onboarding_plan_revisions WHERE purged_at IS NOT NULL AND candidate_id IS NULL
     );

  -- Now delete the candidate itself (onboarding_runs still CASCADEs).
  DELETE FROM public.candidates WHERE id = _candidate_id;

  RETURN jsonb_build_object(
    'ok', true,
    'candidate_id', _candidate_id,
    'revisions_detached', v_rev_count,
    'purged_by', v_uid,
    'purged_at', now()
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.admin_purge_candidate(uuid, text) TO authenticated;

-- ============================================================================
-- 4) is_current flag replaces one_approved_per_candidate
-- ============================================================================
ALTER TABLE public.onboarding_plan_revisions
  ADD COLUMN IF NOT EXISTS is_current boolean NOT NULL DEFAULT false;

DROP INDEX IF EXISTS public.one_approved_per_candidate;

CREATE UNIQUE INDEX IF NOT EXISTS opr_one_current_per_candidate
  ON public.onboarding_plan_revisions (candidate_id)
  WHERE is_current AND candidate_id IS NOT NULL;

-- Backfill: latest approved per candidate becomes current
UPDATE public.onboarding_plan_revisions r
   SET is_current = true
  FROM (
    SELECT DISTINCT ON (candidate_id) id
      FROM public.onboarding_plan_revisions
     WHERE status = 'approved' AND candidate_id IS NOT NULL
     ORDER BY candidate_id, revision_number DESC
  ) latest
 WHERE r.id = latest.id;

-- Allow flipping is_current in the immutability trigger
CREATE OR REPLACE FUNCTION public.enforce_revision_immutability()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.plan IS DISTINCT FROM OLD.plan THEN
    RAISE EXCEPTION 'onboarding_plan_revisions.plan is immutable (create a new revision instead)';
  END IF;
  IF NEW.revision_number <> OLD.revision_number THEN RAISE EXCEPTION 'revision_number is immutable'; END IF;
  IF NEW.authored_source <> OLD.authored_source THEN RAISE EXCEPTION 'authored_source is immutable'; END IF;
  IF NEW.created_at    <> OLD.created_at    THEN RAISE EXCEPTION 'created_at is immutable'; END IF;
  -- candidate_id may be nulled by admin_purge_candidate() only
  IF NEW.candidate_id IS DISTINCT FROM OLD.candidate_id AND NEW.candidate_id IS NOT NULL THEN
    RAISE EXCEPTION 'candidate_id cannot be re-linked once set';
  END IF;

  IF OLD.decided_at IS NOT NULL THEN
    IF NEW.status IS DISTINCT FROM OLD.status
       AND NOT (OLD.status = 'approved' AND NEW.status = 'approved')  -- allow is_current flip
    THEN RAISE EXCEPTION 'status is immutable once decided'; END IF;
    IF NEW.decision_note IS DISTINCT FROM OLD.decision_note THEN RAISE EXCEPTION 'decision_note is immutable once decided'; END IF;
    IF NEW.decided_at IS DISTINCT FROM OLD.decided_at THEN RAISE EXCEPTION 'decided_at is immutable once decided'; END IF;
    IF NEW.approver_user_id IS DISTINCT FROM OLD.approver_user_id THEN RAISE EXCEPTION 'approver_user_id is immutable once decided'; END IF;
  END IF;

  IF OLD.status = 'superseded' AND NEW.status <> 'superseded' THEN
    RAISE EXCEPTION 'superseded revisions cannot be reactivated';
  END IF;

  RETURN NEW;
END;
$function$;

-- Promote current on approval
CREATE OR REPLACE FUNCTION public.opr_promote_current()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'approved' AND (OLD.status IS NULL OR OLD.status <> 'approved') AND NEW.candidate_id IS NOT NULL THEN
    UPDATE public.onboarding_plan_revisions
       SET is_current = false, updated_at = now()
     WHERE candidate_id = NEW.candidate_id
       AND id <> NEW.id
       AND is_current;
    UPDATE public.onboarding_plan_revisions
       SET is_current = true, updated_at = now()
     WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS opr_promote_current ON public.onboarding_plan_revisions;
CREATE TRIGGER opr_promote_current
AFTER UPDATE ON public.onboarding_plan_revisions
FOR EACH ROW EXECUTE FUNCTION public.opr_promote_current();

-- ============================================================================
-- 5) Approver resolution — before insert, fill in approver from HM or setting.
-- ============================================================================
INSERT INTO public.app_settings(key, value)
VALUES ('onboarding_plan_default_approver_user_id', 'null'::jsonb)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.opr_resolve_approver()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_hm uuid;
  v_default uuid;
BEGIN
  IF NEW.approver_user_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT hiring_manager_id INTO v_hm
    FROM public.candidates WHERE id = NEW.candidate_id;
  IF v_hm IS NOT NULL THEN
    NEW.approver_user_id := v_hm;
    RETURN NEW;
  END IF;

  SELECT NULLIF(value #>> '{}', '')::uuid INTO v_default
    FROM public.app_settings WHERE key = 'onboarding_plan_default_approver_user_id';
  IF v_default IS NOT NULL THEN
    NEW.approver_user_id := v_default;
    RETURN NEW;
  END IF;

  -- Last resort: earliest admin
  SELECT user_id INTO NEW.approver_user_id
    FROM public.user_roles WHERE role = 'admin' ORDER BY user_id LIMIT 1;

  IF NEW.approver_user_id IS NULL THEN
    RAISE EXCEPTION 'No approver could be resolved for onboarding plan revision (set onboarding_plan_default_approver_user_id or hiring_manager_id)';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS opr_resolve_approver ON public.onboarding_plan_revisions;
CREATE TRIGGER opr_resolve_approver
BEFORE INSERT ON public.onboarding_plan_revisions
FOR EACH ROW EXECUTE FUNCTION public.opr_resolve_approver();

-- ============================================================================
-- 6) Rewrite inbox sync: status-based (so changes_requested is reflected).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.sync_onboarding_plan_to_inbox()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  cand_name text;
  mapped_status public.approval_status;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status = 'pending_review' THEN
    SELECT name INTO cand_name FROM public.candidates WHERE id = NEW.candidate_id;
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
      NEW.approver_user_id,
      '/recruitment?candidate=' || NEW.candidate_id::text || '&plan=' || NEW.id::text
    );
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    mapped_status := CASE NEW.status
      WHEN 'pending_review'    THEN 'pending'::approval_status
      WHEN 'approved'          THEN 'approved'::approval_status
      WHEN 'rejected'          THEN 'rejected'::approval_status
      WHEN 'changes_requested' THEN 'changes_requested'::approval_status
      WHEN 'superseded'        THEN 'cancelled'::approval_status
      ELSE 'pending'::approval_status
    END;
    UPDATE public.approvals
       SET status = mapped_status,
           decision_note = NEW.decision_note,
           decided_at = COALESCE(NEW.decided_at, CASE WHEN NEW.status IN ('rejected','superseded') THEN now() ELSE decided_at END),
           approver_user_id = NEW.approver_user_id,
           updated_at = now()
     WHERE source_table = 'onboarding_plan_revisions'
       AND source_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$function$;

-- ============================================================================
-- 7) sync_approved_plan_to_run — scope to the specific run
-- ============================================================================
CREATE OR REPLACE FUNCTION public.sync_approved_plan_to_run()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'approved' AND (OLD.status IS DISTINCT FROM 'approved') AND NEW.candidate_id IS NOT NULL THEN
    IF NEW.onboarding_run_id IS NOT NULL THEN
      UPDATE public.onboarding_runs
         SET plan_30_60_90 = NEW.plan, updated_at = now()
       WHERE id = NEW.onboarding_run_id;
    ELSE
      -- Fallback: latest run for the candidate
      UPDATE public.onboarding_runs
         SET plan_30_60_90 = NEW.plan, updated_at = now()
       WHERE id = (
         SELECT id FROM public.onboarding_runs
          WHERE candidate_id = NEW.candidate_id
          ORDER BY created_at DESC LIMIT 1
       );
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- ============================================================================
-- 8) Notifications trigger — assignment / decision events
-- ============================================================================
CREATE OR REPLACE FUNCTION public.opr_emit_notifications()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  cand_name text;
  link_path text;
BEGIN
  IF NEW.candidate_id IS NULL THEN RETURN NEW; END IF;
  SELECT name INTO cand_name FROM public.candidates WHERE id = NEW.candidate_id;
  link_path := '/recruitment?candidate=' || NEW.candidate_id::text || '&plan=' || NEW.id::text;

  IF TG_OP = 'INSERT' AND NEW.status = 'pending_review' AND NEW.approver_user_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, kind, title, body, link)
    VALUES (NEW.approver_user_id, 'onboarding_plan_pending',
      'Plan v' || NEW.revision_number || ' awaiting your review',
      'Onboarding plan for ' || COALESCE(cand_name, 'candidate') || ' needs approval.',
      link_path);
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    -- Notify author on decision
    IF NEW.status IN ('approved','rejected','changes_requested') AND NEW.authored_by IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, kind, title, body, link)
      VALUES (NEW.authored_by, 'onboarding_plan_decided',
        'Plan v' || NEW.revision_number || ' — ' || NEW.status,
        COALESCE(NEW.decision_note, 'Decision recorded on onboarding plan for ' || COALESCE(cand_name, 'candidate') || '.'),
        link_path);
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS opr_emit_notifications_insert ON public.onboarding_plan_revisions;
CREATE TRIGGER opr_emit_notifications_insert
AFTER INSERT ON public.onboarding_plan_revisions
FOR EACH ROW EXECUTE FUNCTION public.opr_emit_notifications();

DROP TRIGGER IF EXISTS opr_emit_notifications_update ON public.onboarding_plan_revisions;
CREATE TRIGGER opr_emit_notifications_update
AFTER UPDATE ON public.onboarding_plan_revisions
FOR EACH ROW EXECUTE FUNCTION public.opr_emit_notifications();

-- ============================================================================
-- 9) Approver-decision enforcement trigger (defense in depth)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.opr_enforce_approver_on_decide()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  -- Only guard actual decisions
  IF NEW.status IN ('approved','rejected','changes_requested')
     AND NEW.status IS DISTINCT FROM OLD.status THEN
    IF v_uid IS NULL THEN
      RAISE EXCEPTION 'authentication required to decide plan';
    END IF;
    IF v_uid <> OLD.approver_user_id AND NOT public.has_role(v_uid, 'admin') THEN
      RAISE EXCEPTION 'only the assigned approver or a global admin may decide this plan';
    END IF;
    -- Stamp actor
    NEW.approver_user_id := COALESCE(NEW.approver_user_id, v_uid);
    -- Audit override
    IF v_uid <> OLD.approver_user_id THEN
      NEW.decision_note := COALESCE(NEW.decision_note, '') ||
        E'\n[admin override by ' || v_uid::text || ']';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS opr_enforce_approver_on_decide ON public.onboarding_plan_revisions;
CREATE TRIGGER opr_enforce_approver_on_decide
BEFORE UPDATE ON public.onboarding_plan_revisions
FOR EACH ROW EXECUTE FUNCTION public.opr_enforce_approver_on_decide();

-- ============================================================================
-- 10) RLS — tightened permission matrix
-- ============================================================================
-- Helper: can this user view / edit a candidate's plan?
CREATE OR REPLACE FUNCTION public.can_view_candidate_plan(_candidate_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT
    _user_id IS NOT NULL AND (
      public.has_role(_user_id, 'admin')
      OR EXISTS (
        SELECT 1 FROM public.candidates c
         WHERE c.id = _candidate_id
           AND c.hiring_manager_id = _user_id
      )
      OR EXISTS (
        SELECT 1 FROM public.onboarding_plan_revisions r
         WHERE r.candidate_id = _candidate_id
           AND (r.approver_user_id = _user_id OR r.authored_by = _user_id)
      )
    )
$$;

CREATE OR REPLACE FUNCTION public.can_edit_candidate_plan(_candidate_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT
    _user_id IS NOT NULL AND (
      public.has_role(_user_id, 'admin')
      OR EXISTS (
        SELECT 1 FROM public.candidates c
         WHERE c.id = _candidate_id
           AND c.hiring_manager_id = _user_id
      )
    )
$$;

DROP POLICY IF EXISTS "Authenticated can view plan revisions" ON public.onboarding_plan_revisions;
DROP POLICY IF EXISTS "Recruitment admins manage plan revisions" ON public.onboarding_plan_revisions;
DROP POLICY IF EXISTS "Recruitment admins update plan revisions" ON public.onboarding_plan_revisions;

CREATE POLICY "Stakeholders view plan revisions"
  ON public.onboarding_plan_revisions FOR SELECT
  TO authenticated
  USING (
    candidate_id IS NULL AND public.has_role(auth.uid(), 'admin')
    OR public.can_view_candidate_plan(candidate_id, auth.uid())
  );

CREATE POLICY "Hiring managers and admins insert plan revisions"
  ON public.onboarding_plan_revisions FOR INSERT
  TO authenticated
  WITH CHECK (
    public.can_edit_candidate_plan(candidate_id, auth.uid())
  );

CREATE POLICY "Approvers and admins update plan revisions"
  ON public.onboarding_plan_revisions FOR UPDATE
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR auth.uid() = approver_user_id
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR auth.uid() = approver_user_id
  );

-- ============================================================================
-- 11) Deletion path — RLS DELETE for admin only + block trigger enforces GUC
-- ============================================================================
DROP POLICY IF EXISTS "Admins delete plan revisions" ON public.onboarding_plan_revisions;
CREATE POLICY "Admins delete plan revisions"
  ON public.onboarding_plan_revisions FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

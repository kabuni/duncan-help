
-- 1. Rewrite approver resolution: never fall back to Hiring Manager / author.
CREATE OR REPLACE FUNCTION public.opr_resolve_approver()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_default uuid;
  v_author uuid := NEW.authored_by;
BEGIN
  -- If an explicit approver was passed AND it's not the author, keep it.
  IF NEW.approver_user_id IS NOT NULL
     AND (v_author IS NULL OR NEW.approver_user_id <> v_author) THEN
    RETURN NEW;
  END IF;

  -- Clear self-assignment before resolving a replacement.
  IF NEW.approver_user_id IS NOT NULL AND NEW.approver_user_id = v_author THEN
    NEW.approver_user_id := NULL;
  END IF;

  -- 1. Configured default approver.
  SELECT NULLIF(value #>> '{}', '')::uuid INTO v_default
    FROM public.app_settings
   WHERE key = 'onboarding_plan_default_approver_user_id';
  IF v_default IS NOT NULL AND (v_author IS NULL OR v_default <> v_author) THEN
    NEW.approver_user_id := v_default;
    RETURN NEW;
  END IF;

  -- 2. First active admin (excluding the author).
  SELECT ur.user_id INTO NEW.approver_user_id
    FROM public.user_roles ur
   WHERE ur.role = 'admin'
     AND (v_author IS NULL OR ur.user_id <> v_author)
   ORDER BY ur.user_id
   LIMIT 1;

  IF NEW.approver_user_id IS NULL THEN
    RAISE EXCEPTION 'No approver could be resolved (author cannot self-approve). Set onboarding_plan_default_approver_user_id or ensure an admin exists.';
  END IF;
  RETURN NEW;
END;
$function$;

-- 2. Hard guard: block self-approval at the DB layer (author cannot decide unless global admin).
CREATE OR REPLACE FUNCTION public.opr_enforce_approver_on_decide()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_is_admin boolean;
  v_failed boolean;
BEGIN
  IF NEW.status IN ('approved','rejected','changes_requested')
     AND NEW.status IS DISTINCT FROM OLD.status THEN
    IF v_uid IS NULL THEN
      RAISE EXCEPTION 'authentication required to decide plan';
    END IF;

    v_is_admin := public.has_role(v_uid, 'admin');

    -- Block placeholder / failed AI drafts from ever being decided.
    v_failed := COALESCE((OLD.plan->>'_ai_draft_failed')::boolean, false);
    IF v_failed THEN
      RAISE EXCEPTION 'This revision is a placeholder from a failed AI draft. The hiring manager must author a new revision before it can be decided.';
    END IF;

    -- Separation of duties: author cannot decide their own plan (admin override allowed but audited).
    IF OLD.authored_by IS NOT NULL AND v_uid = OLD.authored_by AND NOT v_is_admin THEN
      RAISE EXCEPTION 'The author of an onboarding plan cannot approve, reject, or request changes on their own revision.';
    END IF;

    -- Only assigned approver or admin may decide.
    IF v_uid <> OLD.approver_user_id AND NOT v_is_admin THEN
      RAISE EXCEPTION 'only the assigned approver or a global admin may decide this plan';
    END IF;

    NEW.approver_user_id := COALESCE(NEW.approver_user_id, v_uid);

    -- Audit override note when admin acts as author or as non-assigned approver.
    IF v_is_admin AND (v_uid = OLD.authored_by OR v_uid <> OLD.approver_user_id) THEN
      NEW.decision_note := COALESCE(NEW.decision_note, '') ||
        E'\n[admin override by ' || v_uid::text || ']';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- 3. Remediate existing pending rows where approver == author (would be un-decidable).
UPDATE public.onboarding_plan_revisions r
   SET approver_user_id = NULL
 WHERE r.status = 'pending_review'
   AND r.authored_by IS NOT NULL
   AND r.approver_user_id = r.authored_by;

-- Re-resolve by touching each row (fires opr_resolve_approver via BEFORE UPDATE if attached there),
-- otherwise pick default/admin directly.
DO $$
DECLARE
  r record;
  v_default uuid;
  v_admin uuid;
BEGIN
  SELECT NULLIF(value #>> '{}', '')::uuid INTO v_default
    FROM public.app_settings WHERE key = 'onboarding_plan_default_approver_user_id';

  FOR r IN SELECT id, authored_by FROM public.onboarding_plan_revisions
           WHERE status = 'pending_review' AND approver_user_id IS NULL LOOP
    IF v_default IS NOT NULL AND (r.authored_by IS NULL OR v_default <> r.authored_by) THEN
      UPDATE public.onboarding_plan_revisions SET approver_user_id = v_default WHERE id = r.id;
    ELSE
      SELECT ur.user_id INTO v_admin FROM public.user_roles ur
       WHERE ur.role = 'admin' AND (r.authored_by IS NULL OR ur.user_id <> r.authored_by)
       ORDER BY ur.user_id LIMIT 1;
      IF v_admin IS NOT NULL THEN
        UPDATE public.onboarding_plan_revisions SET approver_user_id = v_admin WHERE id = r.id;
      END IF;
    END IF;
  END LOOP;
END $$;

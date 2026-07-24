CREATE OR REPLACE FUNCTION public.prevent_profile_escalation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  -- Trusted server-side path (service role / trigger context with no JWT):
  -- auth.uid() is NULL, so allow the update through untouched. Client
  -- requests always carry a JWT and therefore a non-null auth.uid().
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- Admins may change anything.
  IF EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = 'admin'
  ) THEN
    RETURN NEW;
  END IF;

  -- Non-admins: silently lock privileged fields.
  NEW.role_title      := OLD.role_title;
  NEW.approval_status := OLD.approval_status;
  RETURN NEW;
END;
$function$;
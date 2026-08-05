CREATE OR REPLACE FUNCTION public.get_operational_metrics()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  result jsonb;
  since timestamptz := now() - interval '30 days';
  sync_total bigint;
  sync_failed bigint;
  brief_total bigint;
  brief_failed bigint;
  avg_ms numeric;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'not_authorised';
  END IF;

  SELECT COUNT(*), COUNT(*) FILTER (WHERE lower(status) NOT IN ('success','completed'))
    INTO sync_total, sync_failed
  FROM public.sync_logs WHERE created_at >= since;

  SELECT COUNT(*), COUNT(*) FILTER (WHERE lower(status) NOT IN ('success','completed')), AVG(total_ms)
    INTO brief_total, brief_failed, avg_ms
  FROM public.briefing_runs WHERE started_at >= since;

  result := jsonb_build_object(
    'generated_at', now(),
    'job_runs', COALESCE(sync_total,0) + COALESCE(brief_total,0),
    'failed_jobs', COALESCE(sync_failed,0) + COALESCE(brief_failed,0),
    'success_rate', CASE
      WHEN COALESCE(sync_total,0) + COALESCE(brief_total,0) = 0 THEN NULL
      ELSE ROUND(100.0 * ((COALESCE(sync_total,0) + COALESCE(brief_total,0)) - (COALESCE(sync_failed,0) + COALESCE(brief_failed,0)))
             / (COALESCE(sync_total,0) + COALESCE(brief_total,0)), 2)
    END,
    'avg_run_ms', CASE WHEN avg_ms IS NULL THEN NULL ELSE ROUND(avg_ms) END,
    'documents_stored', (
      (SELECT COUNT(*) FROM public.kb_documents)
      + (SELECT COUNT(*) FROM public.documents)
      + (SELECT COUNT(*) FROM public.project_files)
    ),
    'integrations_live', (
      (SELECT COUNT(*) FROM public.company_integrations WHERE lower(status) = 'connected')
      + (SELECT COUNT(DISTINCT integration_id) FROM public.user_integrations WHERE lower(status) = 'connected')
    ),
    'open_issues', (SELECT COUNT(*) FROM public.issues WHERE created_at >= since)
  );

  RETURN result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_operational_metrics() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_operational_metrics() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_operational_metrics() TO service_role;
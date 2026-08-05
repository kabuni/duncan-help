CREATE OR REPLACE FUNCTION public.get_ai_efficiency_metrics()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
  today date := (now() at time zone 'utc')::date;
  week_start date := today - 6;
  prev_week_start date := today - 13;
  month_start date := today - 29;
  prev_month_start date := today - 59;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'not_authorised';
  END IF;

  SELECT jsonb_build_object(
    'generated_at', now(),
    'hours_saved', (
      SELECT jsonb_build_object(
        'today', COALESCE(SUM(minutes_saved) FILTER (WHERE occurred_at::date = today), 0),
        'week', COALESCE(SUM(minutes_saved) FILTER (WHERE occurred_at::date >= week_start), 0),
        'prev_week', COALESCE(SUM(minutes_saved) FILTER (WHERE occurred_at::date >= prev_week_start AND occurred_at::date < week_start), 0),
        'month', COALESCE(SUM(minutes_saved) FILTER (WHERE occurred_at::date >= month_start), 0),
        'prev_month', COALESCE(SUM(minutes_saved) FILTER (WHERE occurred_at::date >= prev_month_start AND occurred_at::date < month_start), 0),
        'all_time', COALESCE(SUM(minutes_saved), 0)
      ) FROM public.savings_events
    ),
    'actions', (
      SELECT jsonb_build_object(
        'total', COUNT(*),
        'month', COUNT(*) FILTER (WHERE occurred_at::date >= month_start)
      ) FROM public.savings_events
    ),
    'top_actions', (
      SELECT COALESCE(jsonb_agg(t), '[]'::jsonb) FROM (
        SELECT se.action_key,
               COALESCE(c.label, se.action_key) AS label,
               COUNT(*)::int AS uses,
               COALESCE(SUM(se.minutes_saved), 0) AS minutes
        FROM public.savings_events se
        LEFT JOIN public.effort_savings_config c ON c.action_key = se.action_key
        WHERE se.occurred_at::date >= month_start
        GROUP BY se.action_key, c.label
        ORDER BY COUNT(*) DESC
        LIMIT 5
      ) t
    ),
    'tokens', (
      SELECT jsonb_build_object(
        'today', COALESCE(SUM(total_tokens) FILTER (WHERE usage_date = today), 0),
        'week', COALESCE(SUM(total_tokens) FILTER (WHERE usage_date >= week_start), 0),
        'prev_week', COALESCE(SUM(total_tokens) FILTER (WHERE usage_date >= prev_week_start AND usage_date < week_start), 0),
        'month', COALESCE(SUM(total_tokens) FILTER (WHERE usage_date >= month_start), 0),
        'prev_month', COALESCE(SUM(total_tokens) FILTER (WHERE usage_date >= prev_month_start AND usage_date < month_start), 0),
        'all_time', COALESCE(SUM(total_tokens), 0)
      ) FROM public.token_usage
    ),
    'requests', (
      SELECT jsonb_build_object(
        'today', COALESCE(SUM(request_count) FILTER (WHERE usage_date = today), 0),
        'week', COALESCE(SUM(request_count) FILTER (WHERE usage_date >= week_start), 0),
        'prev_week', COALESCE(SUM(request_count) FILTER (WHERE usage_date >= prev_week_start AND usage_date < week_start), 0),
        'month', COALESCE(SUM(request_count) FILTER (WHERE usage_date >= month_start), 0),
        'prev_month', COALESCE(SUM(request_count) FILTER (WHERE usage_date >= prev_month_start AND usage_date < month_start), 0),
        'all_time', COALESCE(SUM(request_count), 0)
      ) FROM public.token_usage
    ),
    'active_users', (
      SELECT jsonb_build_object(
        'dau', COUNT(DISTINCT user_id) FILTER (WHERE usage_date = today),
        'wau', COUNT(DISTINCT user_id) FILTER (WHERE usage_date >= week_start),
        'mau', COUNT(DISTINCT user_id) FILTER (WHERE usage_date >= month_start),
        'prev_mau', COUNT(DISTINCT user_id) FILTER (WHERE usage_date >= prev_month_start AND usage_date < month_start)
      ) FROM public.token_usage
    ),
    'workspace_users', (SELECT COUNT(*) FROM public.profiles)
  ) INTO result;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_ai_efficiency_metrics() FROM public;
GRANT EXECUTE ON FUNCTION public.get_ai_efficiency_metrics() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_ai_efficiency_metrics() TO service_role;
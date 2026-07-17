
-- Add cadence to ga report log and swap unique constraint
ALTER TABLE public.ga_daily_report_log ADD COLUMN IF NOT EXISTS cadence text NOT NULL DEFAULT 'daily';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ga_daily_report_log_report_date_key'
  ) THEN
    ALTER TABLE public.ga_daily_report_log DROP CONSTRAINT ga_daily_report_log_report_date_key;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ga_daily_report_log_cadence_period_start_key
  ON public.ga_daily_report_log (cadence, report_date);

-- Registrations rollup RPC (defined for future use; not called in v1 weekly report)
CREATE OR REPLACE FUNCTION public.get_registrations_rollup(_start date, _end date)
RETURNS TABLE(day date, count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT date_trunc('day', created_at)::date AS day, count(*)::bigint
  FROM public.school_registrations
  WHERE created_at >= _start AND created_at < _end + 1
  GROUP BY 1
  ORDER BY 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_registrations_rollup(date, date) TO authenticated, service_role;

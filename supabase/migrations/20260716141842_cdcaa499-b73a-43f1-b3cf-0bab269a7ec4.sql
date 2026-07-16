
-- Daily GA report log (idempotency + audit)
CREATE TABLE IF NOT EXISTS public.ga_daily_report_log (
  report_date date PRIMARY KEY,
  sent_at timestamptz NOT NULL DEFAULT now(),
  recipients jsonb NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'sent',
  error text
);

GRANT ALL ON public.ga_daily_report_log TO service_role;
GRANT SELECT ON public.ga_daily_report_log TO authenticated;

ALTER TABLE public.ga_daily_report_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read GA daily report log"
  ON public.ga_daily_report_log
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Seed default recipients (Palash) if not present
INSERT INTO public.app_settings (key, value)
VALUES ('daily_ga_report_recipients', '["palash@kabuni.com"]'::jsonb)
ON CONFLICT (key) DO NOTHING;

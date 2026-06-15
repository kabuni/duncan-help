UPDATE public.key_events
SET risk_level = 'green',
    risk_reason = NULL,
    missing_fields = '{}',
    is_complete = true
WHERE category IN ('Holiday', 'Travel')
  AND deleted_in_google = false;
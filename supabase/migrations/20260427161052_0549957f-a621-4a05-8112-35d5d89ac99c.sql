
CREATE TABLE IF NOT EXISTS public.fetch_locks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_key text NOT NULL UNIQUE,
  locked_by uuid,
  locked_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '15 minutes')
);

ALTER TABLE public.fetch_locks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view fetch locks"
  ON public.fetch_locks FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins can manage fetch locks"
  ON public.fetch_locks FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

ALTER TABLE public.candidates
  ADD COLUMN IF NOT EXISTS attachment_filename text;

UPDATE public.candidates
SET attachment_filename = regexp_replace(cv_storage_path, '^[0-9]+_', '')
WHERE attachment_filename IS NULL AND cv_storage_path IS NOT NULL;

CREATE INDEX IF NOT EXISTS candidates_msg_attachment_idx
  ON public.candidates (gmail_message_id, attachment_filename);

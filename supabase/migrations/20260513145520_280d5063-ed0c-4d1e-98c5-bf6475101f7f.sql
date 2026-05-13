ALTER TABLE public.event_rsvps
  ADD COLUMN IF NOT EXISTS reply_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS reply_message_id text,
  ADD COLUMN IF NOT EXISTS reply_error text;
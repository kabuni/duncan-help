
ALTER TABLE public.workstream_cards
  ADD COLUMN IF NOT EXISTS status_source text NOT NULL DEFAULT 'automatic',
  ADD COLUMN IF NOT EXISTS manual_status_set_at timestamptz;

ALTER TABLE public.workstream_cards
  DROP CONSTRAINT IF EXISTS workstream_cards_status_source_check;
ALTER TABLE public.workstream_cards
  ADD CONSTRAINT workstream_cards_status_source_check
  CHECK (status_source IN ('manual', 'automatic'));

-- Backfill: any card with a prior status_changed activity is treated as manual.
UPDATE public.workstream_cards c
   SET status_source = 'manual',
       manual_status_set_at = sub.last_change
  FROM (
    SELECT card_id, MAX(created_at) AS last_change
      FROM public.workstream_activity
     WHERE action = 'status_changed'
     GROUP BY card_id
  ) sub
 WHERE c.id = sub.card_id
   AND c.status_source = 'automatic';

CREATE INDEX IF NOT EXISTS idx_workstream_cards_status_source
  ON public.workstream_cards(status_source);

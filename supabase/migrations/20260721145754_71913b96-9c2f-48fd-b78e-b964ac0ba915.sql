ALTER TABLE public.plan90_deliverables ADD COLUMN IF NOT EXISTS display_order integer;

WITH ordered AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY workstream_id ORDER BY created_at, id) * 10 AS rn
  FROM public.plan90_deliverables
)
UPDATE public.plan90_deliverables d SET display_order = o.rn
FROM ordered o WHERE d.id = o.id;

ALTER TABLE public.plan90_deliverables ALTER COLUMN display_order SET DEFAULT 0;
CREATE INDEX IF NOT EXISTS plan90_deliverables_order_idx ON public.plan90_deliverables(workstream_id, display_order);
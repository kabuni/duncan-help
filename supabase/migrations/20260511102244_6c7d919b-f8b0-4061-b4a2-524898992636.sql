DELETE FROM public.approvals a
USING public.approvals b
WHERE a.ctid < b.ctid
  AND a.source_table = b.source_table
  AND a.source_id    = b.source_id;

ALTER TABLE public.approvals
  ADD CONSTRAINT approvals_source_unique UNIQUE (source_table, source_id);
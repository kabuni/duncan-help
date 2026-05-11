ALTER TABLE public.azure_work_items ADD COLUMN IF NOT EXISTS release text;
CREATE INDEX IF NOT EXISTS idx_azure_work_items_release ON public.azure_work_items(release);
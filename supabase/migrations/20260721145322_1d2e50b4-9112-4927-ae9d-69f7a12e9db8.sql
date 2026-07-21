ALTER TABLE public.plan90_workstreams REPLICA IDENTITY FULL;
ALTER TABLE public.plan90_deliverables REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.plan90_workstreams;
ALTER PUBLICATION supabase_realtime ADD TABLE public.plan90_deliverables;
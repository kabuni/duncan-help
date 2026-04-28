-- Merge historical duplicates (reversible: status only, no deletes)
UPDATE public.candidates
SET status = 'duplicate_merged',
    failure_reason = 'Historical duplicate merged (kept aca95344-12c0-4e16-b43f-c54bc426ae3e)'
WHERE id = 'c0d7a7fc-48eb-42f5-889a-46923c63fd09';

UPDATE public.candidates
SET status = 'duplicate_merged',
    failure_reason = 'Historical duplicate merged (kept 341daa06-8b21-4aeb-8209-3b0abd7c6855)'
WHERE id = '4cd01db9-a7fd-41d9-a6b8-657a6ef63f62';
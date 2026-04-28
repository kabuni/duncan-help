
-- Mark historical duplicates (keep best per name+job_role_id)
UPDATE candidates SET status = 'duplicate_merged', failure_reason = 'historical duplicate cleanup'
WHERE id IN (
  '47746c84-3eeb-4663-be95-ed5a1ed1e295',
  '05ab9ba2-6be8-403c-aa8c-bfa37f93adaa',
  'b3f3156e-3193-41ab-a977-ccc4ee87c162'
);

-- Mark non-CV junk rows
UPDATE candidates SET status = 'duplicate_merged', failure_reason = 'non-cv document'
WHERE job_role_id IS NULL
  AND status <> 'duplicate_merged'
  AND (
    lower(name) LIKE '%agreement%' OR
    lower(name) LIKE '%nda%' OR
    lower(name) LIKE '%invoice%' OR
    lower(name) LIKE '%receipt%' OR
    lower(name) LIKE '%contract%' OR
    lower(name) LIKE '%offer letter%' OR
    lower(name) LIKE '%employment letter%'
  );

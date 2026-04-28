
-- STEP 1: Safe deletion of duplicate candidates
-- Strict guards: never delete fully_scored, never delete the highest-score row in a group,
-- never delete the chosen keep row.
WITH ranked AS (
  SELECT
    id,
    gmail_message_id,
    attachment_filename,
    status,
    total_score,
    ROW_NUMBER() OVER (
      PARTITION BY gmail_message_id, attachment_filename
      ORDER BY
        (status = 'fully_scored') DESC,
        COALESCE(total_score, -1) DESC,
        updated_at DESC NULLS LAST,
        created_at DESC NULLS LAST,
        id
    ) AS rn,
    MAX(COALESCE(total_score, -1)) OVER (
      PARTITION BY gmail_message_id, attachment_filename
    ) AS group_max_score,
    COUNT(*) OVER (
      PARTITION BY gmail_message_id, attachment_filename
    ) AS group_size
  FROM public.candidates
  WHERE gmail_message_id IS NOT NULL
    AND attachment_filename IS NOT NULL
)
DELETE FROM public.candidates c
USING ranked r
WHERE c.id = r.id
  AND r.rn > 1
  AND r.group_size > 1
  AND r.status <> 'fully_scored'
  AND NOT (COALESCE(r.total_score, -1) = r.group_max_score AND r.group_max_score > -1);

-- STEP 2: Add permanent uniqueness guard so the same CV can never be inserted twice
CREATE UNIQUE INDEX IF NOT EXISTS candidates_unique_attachment
ON public.candidates (gmail_message_id, attachment_filename)
WHERE gmail_message_id IS NOT NULL AND attachment_filename IS NOT NULL;

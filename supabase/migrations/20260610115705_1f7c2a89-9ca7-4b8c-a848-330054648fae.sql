
CREATE TABLE IF NOT EXISTS public.kb_query_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  query text NOT NULL,
  query_normalized text NOT NULL,
  document_ids uuid[] NOT NULL DEFAULT '{}',
  similarities double precision[] NOT NULL DEFAULT '{}',
  top_similarity double precision,
  result_count integer NOT NULL DEFAULT 0,
  latency_ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.kb_query_log TO authenticated;
GRANT ALL ON public.kb_query_log TO service_role;

ALTER TABLE public.kb_query_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "kb_query_log_admin_select"
  ON public.kb_query_log FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS idx_kb_query_log_created_at ON public.kb_query_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_kb_query_log_query_normalized ON public.kb_query_log (query_normalized);
CREATE INDEX IF NOT EXISTS idx_kb_query_log_document_ids ON public.kb_query_log USING GIN (document_ids);

-- Analytics views. SECURITY INVOKER so RLS on kb_query_log applies — only
-- admins can read these.
CREATE OR REPLACE VIEW public.kb_query_log_top_queries
WITH (security_invoker = true) AS
SELECT
  query_normalized,
  MIN(query) AS sample_query,
  COUNT(*)::int AS search_count,
  ROUND(AVG(COALESCE(top_similarity, 0))::numeric, 3) AS avg_top_similarity,
  ROUND(AVG(result_count)::numeric, 1) AS avg_result_count,
  MAX(created_at) AS last_searched_at
FROM public.kb_query_log
WHERE created_at > now() - interval '30 days'
GROUP BY query_normalized
ORDER BY search_count DESC, last_searched_at DESC;

CREATE OR REPLACE VIEW public.kb_query_log_top_documents
WITH (security_invoker = true) AS
SELECT
  d.id AS document_id,
  d.title,
  d.file_type,
  d.scope,
  COUNT(*)::int AS retrieval_count,
  MAX(l.created_at) AS last_retrieved_at
FROM public.kb_query_log l
CROSS JOIN LATERAL unnest(l.document_ids) AS doc_id
JOIN public.documents d ON d.id = doc_id
WHERE l.created_at > now() - interval '30 days'
GROUP BY d.id, d.title, d.file_type, d.scope
ORDER BY retrieval_count DESC;

CREATE OR REPLACE VIEW public.kb_query_log_unretrieved_documents
WITH (security_invoker = true) AS
SELECT d.id, d.title, d.file_type, d.scope, d.chunk_count, d.created_at
FROM public.documents d
WHERE d.status = 'ready'
  AND NOT EXISTS (
    SELECT 1 FROM public.kb_query_log l
    WHERE d.id = ANY(l.document_ids)
      AND l.created_at > now() - interval '30 days'
  )
ORDER BY d.created_at DESC;

CREATE OR REPLACE VIEW public.kb_query_log_avg_similarity_by_query
WITH (security_invoker = true) AS
SELECT
  query_normalized,
  MIN(query) AS sample_query,
  COUNT(*)::int AS search_count,
  ROUND(AVG(COALESCE(top_similarity, 0))::numeric, 3) AS avg_top_similarity,
  ROUND(MIN(COALESCE(top_similarity, 0))::numeric, 3) AS min_top_similarity,
  ROUND(MAX(COALESCE(top_similarity, 0))::numeric, 3) AS max_top_similarity
FROM public.kb_query_log
WHERE created_at > now() - interval '30 days'
GROUP BY query_normalized
ORDER BY avg_top_similarity ASC, search_count DESC;

CREATE OR REPLACE VIEW public.kb_query_log_weak_queries
WITH (security_invoker = true) AS
SELECT
  id,
  user_id,
  query,
  top_similarity,
  result_count,
  created_at
FROM public.kb_query_log
WHERE created_at > now() - interval '30 days'
  AND (top_similarity IS NULL OR top_similarity < 0.55 OR result_count = 0)
ORDER BY created_at DESC;

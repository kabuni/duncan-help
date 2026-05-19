-- Drop legacy match_documents (targeted old kb_document_chunks, no live callers)
DROP FUNCTION IF EXISTS public.match_documents(vector, double precision, integer, uuid);

-- Documents table
CREATE TABLE public.documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  file_name text NOT NULL,
  file_type text NOT NULL,
  scope text NOT NULL CHECK (scope IN ('public','private')),
  category text,
  subcategory text,
  tags text[] NOT NULL DEFAULT '{}',
  blob_url text NOT NULL DEFAULT '',
  blob_path text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing','ready','failed')),
  error_message text,
  chunk_count integer NOT NULL DEFAULT 0,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_documents_owner ON public.documents(owner_id);
CREATE INDEX idx_documents_scope_status ON public.documents(scope, status);

CREATE TRIGGER trg_documents_updated_at
  BEFORE UPDATE ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "documents_select" ON public.documents
  FOR SELECT TO authenticated
  USING (scope = 'public' OR owner_id = auth.uid());

CREATE POLICY "documents_insert" ON public.documents
  FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY "documents_update" ON public.documents
  FOR UPDATE TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY "documents_delete" ON public.documents
  FOR DELETE TO authenticated
  USING (owner_id = auth.uid());

-- Chunks table
CREATE TABLE public.document_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  content text NOT NULL,
  embedding vector(1024),
  chunk_index integer NOT NULL,
  token_count integer,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_document_chunks_document ON public.document_chunks(document_id);
CREATE INDEX idx_document_chunks_embedding
  ON public.document_chunks USING hnsw (embedding vector_cosine_ops);

ALTER TABLE public.document_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "document_chunks_select" ON public.document_chunks
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.documents d
    WHERE d.id = document_chunks.document_id
      AND (d.scope = 'public' OR d.owner_id = auth.uid())
  ));
-- No insert/update/delete policies → only service_role can write.

-- match_documents RPC
CREATE OR REPLACE FUNCTION public.match_documents(
  query_embedding vector(1024),
  match_threshold double precision DEFAULT 0.7,
  match_count integer DEFAULT 10,
  p_user_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  document_id uuid,
  content text,
  chunk_index integer,
  metadata jsonb,
  similarity double precision,
  document_title text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id, c.document_id, c.content, c.chunk_index, c.metadata,
         1 - (c.embedding <=> query_embedding) AS similarity,
         d.title AS document_title
  FROM public.document_chunks c
  JOIN public.documents d ON d.id = c.document_id
  WHERE d.status = 'ready'
    AND c.embedding IS NOT NULL
    AND (d.scope = 'public' OR (d.scope = 'private' AND d.owner_id = p_user_id))
    AND 1 - (c.embedding <=> query_embedding) > match_threshold
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
$$;
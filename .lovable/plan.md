# Duncan Knowledge Base (RAG) — Implementation Plan

A full RAG pipeline: Azure Blob storage for files, Voyage AI embeddings, pgvector retrieval, and a `/knowledge-base` upload UI.

> Note on embeddings dim: existing `project_file_chunks` uses `text-embedding-3-small` (1536). This new system uses Voyage `voyage-3` at **1024 dims** as requested — kept isolated in new tables, no impact on existing RAG.

> Note on Azure auth: existing `azure-blob-api` uses `AZURE_STORAGE_CONNECTION_STRING` (SharedKey). The new `upload-to-azure` function will use a **SAS token** as you specified (new secrets), so the two coexist without touching the existing function.

---

## 1. Database schema (migration)

**Tables**

- `public.kb_documents`
  - `id uuid pk default gen_random_uuid()`
  - `title text not null`
  - `file_name text not null`
  - `file_type text not null`
  - `scope text not null check (scope in ('public','private'))`
  - `category text`, `subcategory text`
  - `tags text[] default '{}'`
  - `blob_url text`, `blob_path text`
  - `status text not null default 'processing' check (status in ('processing','ready','failed'))`
  - `error_message text`
  - `chunk_count integer not null default 0`
  - `owner_id uuid not null references auth.users(id) on delete cascade`
  - `created_at`, `updated_at` (trigger uses `update_updated_at_column`)

- `public.kb_document_chunks`
  - `id uuid pk`
  - `document_id uuid not null references kb_documents(id) on delete cascade`
  - `content text not null`
  - `embedding vector(1024)`
  - `chunk_index int not null`
  - `token_count int`
  - `metadata jsonb not null default '{}'`
  - `created_at timestamptz default now()`

(Prefixed `kb_` to avoid collision with existing `project_files` / `project_file_chunks`.)

**Indexes**
- `create index on kb_document_chunks using hnsw (embedding vector_cosine_ops)`
- btree on `document_id`, `kb_documents(owner_id)`, `(scope)`, `(status)`

**RLS**
- `kb_documents`:
  - SELECT: `scope = 'public' OR owner_id = auth.uid()`
  - INSERT/UPDATE/DELETE: `owner_id = auth.uid()` (admins via `has_role(auth.uid(),'admin')`)
- `kb_document_chunks`:
  - SELECT: chunk's parent document is visible to the user (subquery on kb_documents)
  - INSERT/UPDATE/DELETE: **service_role only** (no policy → blocked for authenticated; service_role bypasses RLS)

**RPC**
```sql
create or replace function public.match_documents(
  query_embedding vector(1024),
  match_threshold float default 0.7,
  match_count int default 10,
  p_user_id uuid default null
) returns table (
  id uuid, document_id uuid, content text, chunk_index int,
  metadata jsonb, similarity float, document_title text
)
language sql stable security definer set search_path = public as $$
  select c.id, c.document_id, c.content, c.chunk_index, c.metadata,
         1 - (c.embedding <=> query_embedding) as similarity,
         d.title
  from kb_document_chunks c
  join kb_documents d on d.id = c.document_id
  where d.status = 'ready'
    and (d.scope = 'public' or (d.scope = 'private' and d.owner_id = p_user_id))
    and 1 - (c.embedding <=> query_embedding) > match_threshold
  order by c.embedding <=> query_embedding
  limit match_count;
$$;
```

---

## 2. Secrets

New secrets to request via `add_secret`:
- `AZURE_STORAGE_ACCOUNT`
- `AZURE_STORAGE_CONTAINER`
- `AZURE_STORAGE_SAS_TOKEN`
- `VOYAGE_AI_API_KEY`

(Reuses existing Supabase service-role secret for chunk inserts.)

---

## 3. Edge Functions

All three: `verify_jwt = false` in `supabase/config.toml`, in-code JWT validation via `supabase.auth.getUser()`, standard CORS.

**`upload-to-azure`**
- Input: `{ file_base64, document_id, user_id, scope, filename }`
- Path: `public/{document_id}/{filename}` or `private/{user_id}/{document_id}/{filename}`
- PUT to `https://{ACCOUNT}.blob.core.windows.net/{CONTAINER}/{path}?{SAS}` with `x-ms-blob-type: BlockBlob`
- Returns `{ blob_url, blob_path }`

**`process-document`**
- Input: `{ document_id }`
- Loads `kb_documents` row (service-role client), downloads file from `blob_url`
- Extracts text: TXT/CSV plain; PDF via `npm:pdf-parse`; DOCX via JSZip + XML parsing (mirrors existing `extract-file-text` patterns)
- Chunk ~500 tokens with ~100 overlap on sentence boundaries (token ≈ chars/4 heuristic)
- Embeds via Voyage `POST https://api.voyageai.com/v1/embeddings` body `{ model: 'voyage-3', input: [...], input_type: 'document' }` in batches of 20
- Inserts chunks with metadata `{ scope, owner_id, category, subcategory, document_title }`
- On success: `status='ready'`, `chunk_count=N`. On error: `status='failed'`, `error_message=...`

**`query-knowledge-base`**
- Input: `{ query, user_id, match_count = 8 }`
- Embeds query (Voyage `input_type='query'`)
- Calls `match_documents` RPC
- Joins title (already returned by RPC) and builds `formatted_context`:
  ```
  The following is from Kabuni's internal knowledge base:

  ---
  Source: {title}
  {content}

  Source: {title}
  {content}
  ---
  ```
- Returns `{ results, formatted_context }`

---

## 4. Frontend

**Hook** `src/hooks/useKnowledgeBase.ts`
- `queryKnowledgeBase(message)` invokes `query-knowledge-base`
- Exposes `{ queryKnowledgeBase, isSearching }`; returns `{ results, formattedContext, hasResults }`

**Page** `src/pages/KnowledgeBase.tsx` at route `/knowledge-base`
- Added to `src/App.tsx` (protected) and to Sidebar nav
- Components (colocated under `src/components/knowledge-base/`):
  - `FileDropzone.tsx` — drag/drop + click, accepts `.pdf .docx .xlsx .txt .csv`, 25MB cap, file list with icon/name/size/remove
  - `ScopeSelector.tsx` — two cards (Building2 / Lock), default Company
  - `CategoryPicker.tsx` — category + dependent subcategory map (constant in `categories.ts`)
  - `TagsInput.tsx` — Enter-to-add chips
  - `RecentUploadsTable.tsx` — last 20 from `kb_documents`, status badge with spinner, delete button; React Query polls every 10s while any row is `processing`
- Upload flow per file:
  1. Insert `kb_documents` row (status `processing`) → get `document_id`
  2. Read as base64, call `upload-to-azure`
  3. Update row with `blob_url`, `blob_path`
  4. Invoke `process-document` (fire-and-forget; UI polls)
  5. Show stages: Uploading → Processing → Embedding → Ready/Failed (with Retry → re-invokes `process-document`)

**Sidebar**: insert "Knowledge Base" entry (BookOpen icon) under existing nav order.

---

## 5. Categories map

```
HR & People: Policies & Handbooks, Benefits & Compensation, Onboarding, Leave & Attendance
Legal & Compliance: Contracts, NDAs, Regulatory, IP
Finance: Budgets, Invoicing, Expense Policies, Reporting
Operations: Processes, Vendors, Tools, Incident Reports
Product & Engineering: Specs, Architecture, Runbooks, Postmortems
Sales & Marketing: Playbooks, Pricing, Collateral, Case Studies
Recruitment: JDs, Interview Guides, Scorecards, Offer Templates
General / Company-Wide: Mission & Values, Org Charts, Announcements, Other
```

---

## 6. Order of execution

1. `supabase--migration` for schema + RPC + RLS (await user approval)
2. `add_secret` for the 4 new secrets (await user)
3. Write three Edge Functions + `config.toml` entries
4. Write hook + page + components, wire route in `App.tsx`, add Sidebar link
5. Smoke-test: upload a small TXT → verify Ready + chunks via `read_query`; test `query-knowledge-base` via `curl_edge_functions`

---

## Open questions (will default if you don't answer)

1. Tables named `kb_documents` / `kb_document_chunks` to avoid colliding with existing `project_files*`. OK? (default: yes)
2. Chat injection — should I also wire `useKnowledgeBase` into `norman-chat` flow now, or leave that for a follow-up prompt? (default: hook only, no chat wiring yet)
3. Delete behavior — when a user deletes a `kb_documents` row, also delete the Azure blob? (default: yes, via `azure-blob-api` extension or inline call)
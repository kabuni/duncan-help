# Knowledge Base (RAG) — Implementation Plan

A four-part build adding a company-wide RAG knowledge base to Duncan. Documents are stored in Azure Blob Storage, chunked + embedded with Voyage AI, persisted in Postgres + pgvector, and queryable from Duncan's chat.

---

## Part 1 — Database & Storage

**New tables (migration)**

`public.documents`
- `id uuid pk default gen_random_uuid()`
- `title text not null`
- `file_name text not null`
- `file_type text not null`
- `scope text not null check (scope in ('public','private'))`
- `category text`, `subcategory text`
- `tags text[] default '{}'`
- `blob_url text not null`, `blob_path text not null`
- `status text not null default 'processing' check (status in ('processing','ready','failed'))`
- `error_message text`
- `chunk_count int not null default 0`
- `owner_id uuid not null references auth.users(id) on delete cascade`
- `created_at`, `updated_at timestamptz` (+ trigger using existing `update_updated_at_column`)

`public.document_chunks`
- `id uuid pk default gen_random_uuid()`
- `document_id uuid not null references documents(id) on delete cascade`
- `content text not null`
- `embedding vector(1024)` (Voyage `voyage-3` dims)
- `chunk_index int not null`
- `token_count int`
- `metadata jsonb not null default '{}'::jsonb`
- `created_at timestamptz default now()`
- HNSW index: `using hnsw (embedding vector_cosine_ops)`
- btree index on `document_id`

**RLS**
- `documents`: select where `scope='public' OR owner_id = auth.uid()`; insert/update/delete where `owner_id = auth.uid()`.
- `document_chunks`: select allowed if user can read the parent `documents` row (subquery); insert/update/delete only `service_role` (no policy for authenticated → blocked).

**RPC**
```sql
match_documents(query_embedding vector(1024), match_threshold float default 0.7,
                match_count int default 10, p_user_id uuid)
```
Joins `document_chunks` → `documents`, filters `status='ready'` AND (`scope='public'` OR `owner_id=p_user_id`) AND `1 - (embedding <=> query_embedding) > match_threshold`, orders by cosine distance, returns `id, document_id, content, chunk_index, metadata, similarity, document_title`. SECURITY DEFINER, search_path=public.

> Note: project already has a `match_documents` (vector dim unspecified, uses `kb_document_chunks`). I'll **drop the old one** before creating the new one (single-arg signature change). I'll confirm with you before doing so — see Open Questions.

**Storage**
- Files live in Azure Blob (existing `AZURE_STORAGE_CONNECTION_STRING` is set; new SAS-based secrets used by the new ingestion function — see Part 2).
- Path convention: `public/{document_id}/{filename}` and `private/{user_id}/{document_id}/{filename}`.

---

## Part 2 — Ingestion Edge Functions

**`upload-to-azure`** (`verify_jwt = true`)
- Input: `{ file_base64, filename, document_id, user_id, scope }`
- Validates user (`getUser()`), enforces `scope`/path rules.
- Uploads via Azure REST `PUT https://{account}.blob.core.windows.net/{container}/{path}?{sas}` with `x-ms-blob-type: BlockBlob`.
- Returns `{ blob_url, blob_path }`.
- Secrets needed: `AZURE_STORAGE_ACCOUNT`, `AZURE_STORAGE_CONTAINER`, `AZURE_STORAGE_SAS_TOKEN`, `VOYAGE_AI_API_KEY` (Part 2/3). I'll request these via `add_secret`.

**`process-document`** (`verify_jwt = false`, invoked server-to-server right after upload)
- Input: `{ document_id }`.
- Reads doc row, downloads bytes from `blob_url`.
- Text extraction:
  - `text/plain`, `csv` → utf-8 decode
  - `pdf` → `npm:pdf-parse`
  - `docx` → `npm:jszip` + XML parse of `word/document.xml`
  - `xlsx` → `npm:xlsx` (sheet_to_csv per sheet)
- Chunker: ~500 tokens, ~100 overlap, sentence-boundary aware (regex split on `.?!\n`, greedy pack to budget).
- Embeddings: Voyage `voyage-3`, `input_type:"document"`, batched 20 inputs/request.
- Inserts chunks (service role) with metadata `{ scope, owner_id, category, subcategory, document_title }`.
- Updates document: `status='ready'`, `chunk_count=N`. On any throw: `status='failed'`, `error_message=err.message`.
- Long-running ⇒ wrap pipeline in `EdgeRuntime.waitUntil` and return 202 immediately.

---

## Part 3 — Query Function & Hook

**`query-knowledge-base`** (`verify_jwt = true`)
- Input: `{ query, user_id, match_count = 8 }`.
- Validates `user_id` matches the JWT user.
- Voyage embed (`input_type:"query"`).
- Calls `match_documents` RPC with `p_user_id`.
- Returns:
  ```json
  {
    "results": [{ document_id, document_title, content, similarity, ... }],
    "formatted_context": "The following is from Kabuni's internal knowledge base:\n\n---\nSource: ...\n[text]\n\n...---",
    "hasResults": true
  }
  ```

**`src/hooks/useKnowledgeBase.ts`**
```ts
const { queryKnowledgeBase, isSearching } = useKnowledgeBase();
// queryKnowledgeBase(message) → { results, formattedContext, hasResults }
```
Uses `supabase.functions.invoke('query-knowledge-base', { body })`. Pure hook — no chat integration in this part (Duncan chat wiring can be a follow-up).

---

## Part 4 — Upload UI (`/knowledge-base`)

New route added to `App.tsx` (protected). New page `src/pages/KnowledgeBase.tsx` inside `AppLayout`, sidebar entry added.

**Components**
- `KBDropzone` — drag/drop + click, accepts `.pdf,.docx,.xlsx,.txt,.csv`, max 25 MB/file, batch list with type icon (Lucide `FileText`/`FileSpreadsheet`/etc), name, size, remove.
- `KBScopePicker` — two selectable cards (`Building2` Company / `Lock` Private). Default Company.
- `KBCategorySelect` + `KBSubcategorySelect` — visible only when scope=Company. Parent→child map defined in a `kbTaxonomy.ts` constant (HR & People, Legal & Compliance, Finance, Operations, Product & Engineering, Sales & Marketing, Recruitment, General).
- `KBTagsInput` — Enter-to-add chip input.
- Upload pipeline per file (sequential, status state machine): `Uploading → Processing → Embedding → Ready ✓` | `Failed ✗ (Retry)`.
  - Insert `documents` row first to get `id` (status `processing`).
  - Call `upload-to-azure` with file base64.
  - Patch `documents.blob_url/blob_path`.
  - Invoke `process-document` (fire-and-forget; UI polls).
- `KBRecentUploads` table — last 20 docs for current user (own + public visible per RLS), columns: title, type icon, scope badge, category, status badge (spinner while processing), date, delete. Polls every 10 s while any row is `processing`.

Styling: Tailwind + shadcn/ui, semantic tokens only, desktop-first.

---

## Technical Details

- **Voyage embeddings model**: `voyage-3` returns 1024-dim float vectors → `vector(1024)` column matches.
- **Existing `match_documents`**: collides on name. Will `DROP FUNCTION public.match_documents(vector, double precision, integer, uuid)` and recreate against the new table. Old `kb_document_chunks` table left intact (no callers will be removed).
- **Secrets to add via `add_secret`**: `AZURE_STORAGE_ACCOUNT`, `AZURE_STORAGE_CONTAINER`, `AZURE_STORAGE_SAS_TOKEN`, `VOYAGE_AI_API_KEY`.
- **Edge function config**: register all three in `supabase/config.toml` (`upload-to-azure` and `query-knowledge-base` with `verify_jwt = true`, `process-document` default).
- **File limits**: enforce 25 MB client-side + double-check inside `upload-to-azure`.
- **Sanitize filenames** with existing `sanitizeStorageFileName` before building `blob_path`.

---

## Files Added / Changed

```text
supabase/migrations/<ts>_kb_documents.sql     (new)
supabase/functions/upload-to-azure/index.ts   (new)
supabase/functions/process-document/index.ts  (new)
supabase/functions/query-knowledge-base/index.ts (new)
supabase/config.toml                          (edit — add 3 function blocks)
src/hooks/useKnowledgeBase.ts                 (new)
src/pages/KnowledgeBase.tsx                   (new)
src/components/kb/KBDropzone.tsx              (new)
src/components/kb/KBScopePicker.tsx           (new)
src/components/kb/KBCategorySelect.tsx        (new)
src/components/kb/KBTagsInput.tsx             (new)
src/components/kb/KBRecentUploads.tsx         (new)
src/lib/kbTaxonomy.ts                         (new)
src/App.tsx                                   (edit — add route)
src/components/Sidebar.tsx                    (edit — add nav entry)
```

---

## Open Questions

1. **Existing `match_documents` RPC** currently targets `kb_document_chunks`. OK to drop it and repoint to the new `document_chunks` table? Any other callers I should be aware of?
2. **Azure auth**: you already have `AZURE_STORAGE_CONNECTION_STRING` (used by `azure-blob-api` with SharedKey HMAC). The spec asks for a SAS-token path with new secrets — should I (a) add the new SAS secrets as specified, or (b) reuse the existing SharedKey flow from `useAzureBlobStorage`/`azure-blob-api`?
3. **Sidebar placement** for the new `/knowledge-base` entry — under Docs, or as a new top-level item?

# RAG Knowledge Base — Remaining Implementation

The database schema, `match_documents` RPC, and HNSW index are already migrated. The `upload-to-azure` edge function is in progress. Below is the plan to finish all four prompts.

## Decisions

- **Embeddings**: OpenAI `text-embedding-3-small` (1536 dims) via `OPENAI_API_KEY` (already set), matching the migrated `vector(1536)` column.
- **Azure auth**: Use SAS token flow per spec. Three new secrets required: `AZURE_STORAGE_ACCOUNT`, `AZURE_STORAGE_CONTAINER`, `AZURE_STORAGE_SAS_TOKEN`. User said "will add later" — functions will be written and deployed; uploads will fail with a clear error until secrets land.
- **Sidebar placement**: New top-level "Knowledge Base" item below "Docs".
- **Polling**: 10s while any doc is `processing`, stops when none remain.

## Edge Functions

1. **`upload-to-azure`** (`verify_jwt = false`, validates user in code via `getUser()`)
   - Input: `{ file_base64, document_id, user_id, scope, filename }`
   - Builds blob path: `public/{document_id}/{filename}` or `private/{user_id}/{document_id}/{filename}`
   - `PUT https://{account}.blob.core.windows.net/{container}/{path}?{sas}` with `x-ms-blob-type: BlockBlob`
   - Returns `{ blob_url, blob_path }`

2. **`process-document`** (`verify_jwt = false`, service-role client)
   - Input: `{ document_id }`
   - Downloads from `blob_url` (SAS appended if private)
   - Text extraction:
     - `txt`/`csv`/`md` → plain text
     - `pdf` → `npm:pdf-parse`
     - `docx` → `npm:jszip` + XML walk of `word/document.xml`
     - `xlsx` → `npm:xlsx` sheet_to_csv
   - Chunker: ~500 tokens (≈2000 chars) with ~100 token overlap, sentence-aware split
   - OpenAI embeddings in batches of 20
   - Bulk insert into `document_chunks` with metadata `{ scope, owner_id, category, subcategory, document_title }`
   - Sets `status='ready'`, `chunk_count=N`; on error `status='failed'` + `error_message`
   - Wrapped in `EdgeRuntime.waitUntil` for long PDFs

3. **`query-knowledge-base`** (`verify_jwt = true`)
   - Input: `{ query, user_id, match_count? = 8 }`
   - Embeds query via OpenAI
   - Calls `match_documents` RPC
   - Returns `{ results, formatted_context }` with the spec'd format string

## Frontend

- **`src/lib/kbTaxonomy.ts`** — categories/subcategories map per spec
- **`src/hooks/useKnowledgeBase.ts`** — `queryKnowledgeBase(message)` → `{ results, formattedContext, hasResults }`, `isSearching`
- **`src/pages/KnowledgeBase.tsx`** — route `/knowledge-base`
- **Components under `src/components/kb/`**:
  - `KBDropzone.tsx` — drag/drop + click, 25MB cap, type icons, remove
  - `KBScopePicker.tsx` — Company/Private cards (Building2/Lock)
  - `KBCategorySelect.tsx` + `KBSubcategorySelect.tsx` — dependent dropdowns
  - `KBTagsInput.tsx` — Enter-to-add chips
  - `KBUploadButton.tsx` — orchestrates Uploading → Processing → Embedding → Ready/Failed per file, retry
  - `KBRecentUploads.tsx` — last 20 docs, badges, spinner, delete, 10s polling
- **`src/App.tsx`** — add `/knowledge-base` route
- **`src/components/Sidebar.tsx`** — add nav entry below Docs

## Upload Pipeline (per file)

1. Insert `documents` row (`status='processing'`) → get `document_id`
2. Read file as base64, call `upload-to-azure` → save `blob_url`, `blob_path`
3. Invoke `process-document` (fire-and-forget); UI polls `documents.status`
4. Statuses surfaced from row: `processing` (with sub-label by step) / `ready` / `failed`

## Files to Add / Edit

**Add**
- `supabase/functions/upload-to-azure/index.ts` (in progress)
- `supabase/functions/process-document/index.ts`
- `supabase/functions/query-knowledge-base/index.ts`
- `src/lib/kbTaxonomy.ts`
- `src/hooks/useKnowledgeBase.ts`
- `src/pages/KnowledgeBase.tsx`
- `src/components/kb/{KBDropzone,KBScopePicker,KBCategorySelect,KBSubcategorySelect,KBTagsInput,KBUploadButton,KBRecentUploads}.tsx`

**Edit**
- `src/App.tsx` (route)
- `src/components/Sidebar.tsx` (nav)

**Already done**
- Migration: `documents`, `document_chunks`, HNSW index, RLS, `match_documents` RPC

## Out of Scope (this batch)

- Wiring `useKnowledgeBase` into the Duncan chat prompt — that's a follow-up after the UI ships and you can verify retrieval quality.
- Re-embedding job for existing project files.

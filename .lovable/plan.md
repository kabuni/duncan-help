## Goal

Produce a single, self-contained briefing prompt you can paste into Claude Code. It should give Claude enough context to scaffold an **independent backend for Duncan** (i.e. replace the current Supabase Edge Functions + Lovable Cloud layer) while keeping the same data model, integrations, and AI behaviour.

Output: one Markdown file at `/mnt/documents/duncan-backend-brief.md` that you can download and hand to Claude Code. No code changes in the app.

## What the brief will contain

1. **Mission & role of the backend**
   - Duncan = single operational intelligence layer for Kabuni
   - Backend responsibilities: auth, RBAC, AI orchestration, integrations proxy, RAG, webhooks, cron jobs, file storage proxying

2. **Target stack guidance for the rebuild**
   - Language/runtime suggestion (Node + TypeScript or Python + FastAPI — Claude picks)
   - Framework-agnostic requirements: HTTP API, SSE streaming, background workers, scheduled jobs (replace `pg_cron`), webhook receivers
   - Must keep OpenAPI-compatible JSON contracts so the existing React frontend can swap base URL only

3. **Data layer**
   - **Primary DB:** PostgreSQL (currently Supabase Postgres). All 71 tables listed by domain group: auth/RBAC, projects, workstreams, recruitment, meetings, integrations/tokens, notifications, CEO briefings, etc.
   - **Azure PostgreSQL replica:** write-behind mirror, `pgvector 0.8.0`, `vector(1536)` columns, HNSW indexes, similarity ops `<->`, `<=>`, `<#>`. Used for semantic search over meetings + project files.
   - Embeddings model: OpenAI `text-embedding-3-small` (1536 dims). Semantic chunking pipeline.
   - Note that `auth.users` is Supabase-managed today and must be replaced with a self-hosted auth table + JWT issuance (or Auth.js / Clerk / Keycloak).
   - RBAC pattern: separate `user_roles` table + `has_role()` SECURITY DEFINER function; never store roles on profiles.
   - RLS policies must be re-implemented as application-level authorization middleware if Postgres RLS isn't used.

4. **File / blob storage**
   - **Azure Blob Storage** — account `stkabunidevstorage01`, container `duncanstorage01`. Primary doc repo + CV backup.
   - Auth via **SharedKey HMAC-SHA256** (custom signer required because no official SDK in edge runtime; in Node use `@azure/storage-blob` instead).
   - Critical gotcha: URL-encode every path segment consistently in **both** the signature string and the request URL, or you get 403.
   - "Allow storage account key access" must be enabled in Azure Portal.
   - Authenticated download proxy pattern (`azure-blob-api`): JWT validated → SharedKey attached → stream to client.

5. **AI orchestration**
   - Direct provider calls (no Lovable AI Gateway):
     - Anthropic `claude-sonnet-4-5-20250929` (primary), `claude-haiku-4-5` (degrade)
     - OpenAI `gpt-5` (primary), `gpt-5-mini` (degrade), `gpt-4o` for current `norman-chat`
   - Shared router with cross-provider fallback on 429 / 5xx / 504 / empty
   - 90s `AbortController` per attempt (`PROVIDER_TIMEOUT_MS`)
   - Workflow → primary-provider routing table (norman-chat, ceo-briefing, analyze-meeting, score-cv-*, generate-jd, etc. → Claude; vision/file workflows extract-chat-file, parse-cv → OpenAI)
   - Multi-round tool-calling loop, max 5 iterations
   - SSE streaming contract for chat
   - Reserve Opus-class models for background jobs only (>150s synthesis, exceeds sync HTTP window — needs job queue + polling)

6. **Integrations (proxy + webhook architecture)**
   For each: OAuth flow, token table, proxy endpoint, webhook receiver where applicable.
   - Google: Gmail, Calendar, Drive, Analytics (per-user OAuth, dedicated `*_tokens` tables, required scopes documented)
   - Basecamp (OAuth proxy, webhook with 60s deduplication, account 6160637)
   - Azure DevOps (single-tenant OAuth, work-item sync, webhook)
   - Hireflix (GraphQL, role syncing, retry queue)
   - Slack (Lovable connector bot for DMs, requires `SLACK_API_KEY`)
   - ElevenLabs (Conversational AI agent + Scribe STT — single-use token issuance server-side)
   - DocuSign (NDA signature webhook — currently decommissioned, mention as historical)
   - **Decommissioned (do NOT rebuild):** Xero, Notion, Legal/NDA tools, general Google Workspace browsing
   - Shared access model: company integrations vs per-user integrations, with Google Drive singleton fallback

7. **Background jobs / scheduling**
   - Replace `pg_cron` with a job runner (BullMQ / Temporal / cron container)
   - Required schedules: hourly overdue workstream check, daily briefing, Gmail CV poll, Hireflix retry processor, Plaud meeting fetch, social stats sync, Azure work-item sync

8. **Realtime / streaming**
   - SSE for chat completions (line-by-line parsing, `[DONE]` sentinel, CRLF-safe)
   - Postgres LISTEN/NOTIFY or WebSockets to replace `supabase_realtime` for notifications + workstream updates

9. **Secrets inventory**
   - Required env vars: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `AZURE_BLOB_ACCOUNT`, `AZURE_BLOB_KEY`, `AZURE_BLOB_CONTAINER`, `AZURE_PG_*`, OAuth client IDs/secrets per integration, `ELEVENLABS_API_KEY`, `SLACK_API_KEY`, `BASECAMP_*`, `HIREFLIX_API_KEY`, `AZURE_DEVOPS_*`

10. **Edge function inventory** (78 functions) — grouped by domain so Claude can map each to a route/handler in the new backend. Will list every current function name.

11. **Conventions to preserve**
    - Internal variable prefix `norman-`, user-facing brand `Duncan`
    - `sanitizeStorageFileName` for all uploads
    - Application URL: `https://duncan.help` (used in OAuth callbacks + Slack DMs)
    - Email rules, copy sanitization, RYG (Red/Yellow/Green) framework

12. **Explicit exclusions per your request**
    - No mention of ngrok or tunneled endpoints

## Deliverable

```text
/mnt/documents/duncan-backend-brief.md   ← single Markdown file
```

You can then either upload it to Claude Code or paste it directly. After approval I'll generate the file in build mode and emit it as a `<lov-artifact>` so you can download it.

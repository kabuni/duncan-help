## Norman Tool Selection Fix — Prevent Unnecessary `fetch_plaud_meetings`

### Problem
The system prompt currently instructs the model to **ALWAYS** call `fetch_plaud_meetings` first when a user asks about a recent meeting. For broad summarization prompts like "Summarize my recent meetings", this triggers a ~20s Gmail sync, consumes the tool-loop execution budget, and prevents `analyze_meetings` from running — final synthesis returns empty.

### Fix (single file, prompt-only)

**File:** `supabase/functions/norman-chat/index.ts`

**1. Update the Meeting Intelligence guidance (line 29)** — replace the "ALWAYS call fetch_plaud_meetings FIRST" rule with explicit gating:

> **Meeting Intelligence**: Use `list_meetings` to browse stored meetings (supports `from_date`/`to_date` and typo-tolerant search), `get_meeting` for a specific meeting's transcript/analysis, `analyze_meetings` to run AI analysis, and `search_meeting_transcripts` for cross-meeting topic search.
>
> **`fetch_plaud_meetings` is a SLOW sync operation (~20s) and must ONLY be called when the user explicitly requests a sync/refresh** — i.e. the prompt contains words like "sync", "fetch latest", "pull new", "refresh meetings", "update meeting data", or "import from Plaud".
>
> **For summarization, analysis, search, or any question about existing meetings (including "today's", "yesterday's", "recent", "this week's"): SKIP `fetch_plaud_meetings`. Go straight to `list_meetings` (with `from_date`/`to_date` when a date is implied), then `get_meeting` or `analyze_meetings` as needed.**
>
> Only fall back to `fetch_plaud_meetings` if `list_meetings` returns zero results AND the user's intent clearly implies a meeting should exist that hasn't been ingested yet.

**2. Update the `fetch_plaud_meetings` tool description (line 553)** to make the gating self-evident to the model:

> "Sync new Plaud AI meeting recordings from Gmail into the meetings database. **SLOW (~20s) — call ONLY when the user explicitly asks to sync/refresh/import meetings (keywords: 'sync', 'fetch latest', 'pull new', 'refresh', 'import').** Do NOT call this for summarization, analysis, search, or general questions about existing meetings — use `list_meetings` instead."

**3. Update the `list_meetings` tool description (line 561)** to reinforce it as the default entry point:

> Prepend: "**Default entry point for any meeting question (summarize, analyze, search, browse).** "

### Out of scope
- No changes to orchestration, tool-loop logic, timeouts, fallback, or streaming.
- No changes to tool execution code or `pickModel` / `WORKFLOW_ROUTING`.

### Expected outcome
For "Summarize my recent meetings": model calls `list_meetings` → `analyze_meetings` (or `get_meeting` per item) → final synthesis. `fetch_plaud_meetings` is not invoked, the ~20s sync is avoided, and the tool loop completes within budget.

# Daily Briefing Reliability Plan

## Objective
Make the Daily Briefing reliable, fast, and independent from the Norman Chat workflow. The briefing is a **report-generation task**, not a conversation — it should have its own lightweight execution path with no tool orchestration.

## Root cause
Today the briefing pipes through `norman-chat`, which attaches the full chat toolset (27/75 tools observed). That inflates the prompt and slows OpenAI's first-token response past the 30s stream-open window → user sees *"Daily Briefing could not be completed."*

The problem is **reliability**, not data retrieval — `daily-briefing` already gathers calendar, meetings, work items, workstreams, planner items, etc., correctly.

## Architecture

```text
Home page
   │
   ▼
ceo-briefing  (queues job)
   │
   ▼
ceo-briefing-worker  (background)
   │
   ├── daily-briefing  ──► structured context object
   │
   ▼
briefing-synthesise  (NEW dedicated LLM call)
   │   • no tools registered
   │   • dedicated executive-briefing system prompt
   │   • gpt-4o → retry → gpt-4o-mini fallback
   │
   ▼
ceo_briefings row  (polled by useCEOBriefing)
```

## Implementation steps

### 1. New edge function: `briefing-synthesise`
Single-purpose synthesiser. Inputs: the structured context from `daily-briefing`. Outputs: the briefing markdown + structured fields (trajectory, scores) for `ceo_briefings`.

- No tool registration. No write workflows. No planner/workstream tool surface.
- Dedicated system prompt focused on executive briefing format (priorities, blockers, key meetings, urgent approvals, deadlines, follow-ups).
- Calls OpenAI directly (consistent with `tech/llm-provider` — bypass AI Gateway).

### 2. Resilience wrapper (`fetchAIWithRetry` pattern)
Per `tech/ai-resilience-strategy`, reuse the existing helper. On the briefing path:
1. Primary: `gpt-4o`.
2. On stream-open timeout / 504 / network abort: retry once on `gpt-4o`.
3. If retry fails: fallback to `gpt-4o-mini` with the same prompt.
4. Log every fallback (model, attempt, reason) to function logs.

### 3. Timeout strategy
- Keep request optimisation (no tools, pre-built context) as the primary fix.
- Raise stream-open timeout to **45s** as a safety net only — not the headline fix.

### 4. Rewire the worker
`ceo-briefing-worker` (or whatever currently invokes `norman-chat` for the briefing) calls `briefing-synthesise` instead. `norman-chat` is no longer in the briefing path.

### 5. Structured logging
For every briefing run, log:
- Context generation time (ms)
- Prompt token count
- LLM generation time (ms)
- Model used + retry count + fallback flag
- Total execution time
- Job ID for correlation with `ceo_briefing_jobs`

### 6. Frontend
No UI changes required. `useCEOBriefing` continues to poll `ceo-briefing-status`; the user sees the same progress phases (`gathering` → `synthesising` → `completed`) with materially fewer failures.

## Out of scope
- `norman-chat` general chat behaviour — untouched.
- Briefing **content / data gathering** in `daily-briefing` — untouched (already correct).
- New briefing formats or new data sources.
- Ingestion pipeline (Plaud / Gemini meeting notes).

## Technical details

**Files to add/change:**
- `supabase/functions/briefing-synthesise/index.ts` — NEW. OpenAI call with retry/fallback, no tools, executive prompt.
- `supabase/functions/ceo-briefing-worker/index.ts` (or current worker) — swap `norman-chat` invocation for `briefing-synthesise`.
- Shared helper (e.g. `supabase/functions/_shared/llmWithFallback.ts`) — extract the retry+fallback pattern if not already shared, so the briefing and any future report task can reuse it.

**Verification:**
- Trigger briefing from Home; confirm `briefing-synthesise` logs show `tools=0`, model attempts, and completion under ~20s.
- Force a primary failure (temporarily wrong model id) → confirm fallback to `gpt-4o-mini` engages and the briefing still renders.
- Confirm `norman-chat` logs no longer show briefing turns.
- Confirm general chat in the sidebar continues to work unchanged with its full tool set.

## Expected outcome
Faster first token, smaller prompts, near-zero briefing failures, cleaner separation between chat and reporting, no impact on Duncan Chat.

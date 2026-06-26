
# Daily Briefing Reliability Plan (v3 — final)

## Objective
Make the Home Daily Briefing its own reliable reporting workflow, fully independent of `norman-chat`, reusing the existing `_shared/llm.ts` router for provider/model/retry/fallback, gracefully degrading on per-source failures, with persisted metrics so we can verify the improvement.

## Findings driving the design

1. **`_shared/llm.ts` already is the reusable LLM router** (workflow-keyed primary/fallback across Claude + OpenAI, retry, model degrade, classified errors, per-workflow timeouts). `ceo-briefing` (the /ceo page) already uses it. No new synthesis layer is needed.
2. **`daily-briefing` has one caller and one downstream purpose** today (the client forwards its JSON straight to `norman-chat` for synthesis). Standing up a separate `briefing-synthesise` edge function would create a service purely for its own sake.
3. **Norman-chat already bypasses tools when `mode === "briefing"`** (line 7180), so "tools attached" isn't the smoking gun — the cost is the giant Norman system prompt + streaming orchestration applied to a one-shot report. Removing norman-chat from this path entirely is the right cut.
4. **`daily-briefing` already wraps each source in try/catch**, but silently coerces failures to `[]`. Half of graceful degradation is already there; it just needs to surface per-source status.

## Architecture

Single edge function, single round trip:

```text
Home page
   │
   ▼
daily-briefing  (rebuilt)
   ├── 1. Gather context (per-source {status, data, error?})
   ├── 2. Build structured context object
   ├── 3. Call _shared/llm.ts → callLLMWithFallback({ workflow: "daily-briefing" })
   ├── 4. Persist a briefing_runs metrics row
   └── 5. Return { markdown, model, fallback_used, degraded_sources, took_ms }
```

`norman-chat` is removed from the briefing path. Norman general chat is untouched.

## Implementation steps

### 1. Rebuild `daily-briefing` with per-source resilience
- Replace silent `[]` fallbacks with `{ status: "ok" | "failed", data, error? }` per source (calendar, meetings, work_items, workstreams, project_tasks, token_usage, leaderboard).
- Synthesis runs on whatever sections are `ok`; `failed` sections are listed in `degraded_sources` and the prompt is instructed to surface them explicitly ("📭 Email pulse unavailable — Gmail token expired").
- Synthesis itself is the only path that can fail the whole briefing.
- Keep the once-per-UTC-day gate, but defer the `last_briefing_at` write until synthesis succeeds (already the design — `mark-briefing-shown` is called from the client on success).

### 2. Add `daily-briefing` workflow to `_shared/llm.ts`
- Extend `WorkflowName` with `"daily-briefing"`.
- Route: `{ primary: "claude", fallback: "openai" }` (long-form synthesis, mirrors `ceo-briefing`).
- No hardcoded models in the function — router picks Sonnet 4.5 → Haiku degrade → GPT-5 → GPT-5-mini degrade. Provider/model changes happen in one file.
- Keep the default 60s per-attempt timeout; override only if measurement says we need it.

### 3. Optional raw-context mode for future reuse
- Accept `?format=context` (or `{ format: "context" }`). When set, return the structured context JSON without calling the LLM. Default is the synthesised briefing. This preserves a clean reuse surface (CEO dashboard widget, weekly digest, etc.) without forcing a second function today.

### 4. Rewire the client off norman-chat
- Replace `useNormanChat.sendBriefing` with a small `useDailyBriefing` hook that calls `supabase.functions.invoke("daily-briefing")` and renders the returned markdown.
- Swap the streamed-text UI for a single loading state ("Generating your briefing…") that resolves to the full briefing. A once-a-day report doesn't need token-by-token streaming; reliability beats animation.
- Surface structured errors from `classifyLLMError` ("Synthesis service rate-limited — try again in a minute") instead of the generic "could not be completed".
- On success → call existing `mark-briefing-shown`. On failure → don't mark.

### 5. Metrics: new `briefing_runs` table
Persist one row per attempt for queryable success-rate / fallback-rate / per-source failure-rate.

| Column | Notes |
| --- | --- |
| `id uuid pk` | |
| `user_id uuid` | FK auth.users |
| `started_at timestamptz` | |
| `total_ms int` | end-to-end |
| `context_ms int` | gather time |
| `llm_ms int` | synthesis time |
| `status text` | `success` \| `failed` |
| `model text` | resolved model id (e.g. `claude-sonnet-4-5-20250929`) |
| `provider text` | `claude` \| `openai` |
| `attempts int` | retries on primary |
| `fallback_used bool` | true if fell to fallback provider |
| `degraded bool` | true if degraded model engaged |
| `degraded_sources text[]` | e.g. `{calendar,emails}` |
| `prompt_tokens int`, `completion_tokens int` | from router usage |
| `error_code text`, `error_message text` | nullable, when `status=failed` |

RLS: `service_role` ALL; `authenticated` SELECT on own rows; admin SELECT all (via `has_role`). Indexed on `(started_at)` and `(user_id, started_at)`.

Plus the same structured `[briefing]` log line for ad-hoc grep.

### 6. Norman-chat cleanup
- Mark the `mode === "briefing"` branch in `norman-chat` as deprecated; remove in a follow-up after one week of clean metrics.

## Verifying the improvement (the point of metrics)

After deploy, run against the `briefing_runs` table:

```text
success_rate   = count(status='success') / count(*)
avg_total_ms   = avg(total_ms)
fallback_rate  = count(fallback_used) / count(*)
retry_rate     = count(attempts > 1) / count(*)
degraded_pct   = count(degraded) / count(*)
top_failing_sources = unnest(degraded_sources), group, count, order desc
```

Target after rollout: success_rate ≥ 99%, p95 total_ms < 25 s, fallback_rate observable (not silently masking primary failures).

## Out of scope
- Norman Chat general behaviour — untouched.
- `/ceo` page (`ceo-briefing` function) — already on the router, separate surface.
- Ingestion pipelines (Plaud / Gemini).
- New briefing content or new data sources.

## Files

- `supabase/functions/_shared/llm.ts` — add `"daily-briefing"` to `WorkflowName` and `WORKFLOW_ROUTING`.
- `supabase/functions/daily-briefing/index.ts` — restructure to per-source status, add synthesis stage via `callLLMWithFallback`, write `briefing_runs` row, support `?format=context`.
- New migration — `briefing_runs` table + RLS + grants + indexes.
- `src/hooks/useDailyBriefing.ts` — NEW small hook (or fold into existing if cleaner).
- `src/hooks/useNormanChat.ts` — remove `sendBriefing`.
- Home page component — call new hook, render markdown.

## Verification

- Trigger briefing on Home → `briefing_runs` row written with `status='success'`, provider/model populated, `degraded_sources` empty on a healthy day.
- Revoke Gmail token → briefing still renders, row shows `degraded_sources={emails}`, `status='success'`.
- Temporarily wrong primary model id → fallback engages, row shows `fallback_used=true`, briefing still renders.
- `norman-chat` logs no longer show `mode=briefing` from Home.
- General sidebar chat unchanged.

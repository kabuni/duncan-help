# Phase 9 — Correctness Layer

Phases 1–8 stopped Duncan from lying about *writes*. Phase 9 stops Duncan from being confidently wrong about *reads* — the much larger surface. The strategy: treat every fact Duncan states as a typed claim with a provenance, a freshness budget, and a confidence floor. If those can't be satisfied, Duncan must hedge or refuse — same posture as the Mutation Truth Rule, applied to knowledge.

---

## 9.1 Read Truth Rule (mirror of Mutation Truth Rule)

Add a `ReadResult<T>` envelope to `_shared/tool-envelope.ts`:

```text
{
  ok: true,
  data: T,
  source: "google_calendar" | "workstreams_db" | "gmail" | ...,
  fetched_at: ISO,
  freshness_sla_seconds: number,
  row_count: number,
  truncated: boolean,
  filters_applied: Record<string,unknown>,
  query_echo: string         // exact filter the tool ran
}
```

Rule enforced in the system prompt + a post-LLM linter:
- Any factual claim about user data MUST cite a `source` from this turn's `ReadResult`s.
- Claims older than `freshness_sla_seconds` must be marked "as of {fetched_at}".
- If `truncated: true` Duncan must say so before summarising.
- If no matching `ReadResult` exists for a claim → strip the claim, replace with "I don't have that".

## 9.2 Tool result honesty — kill silent empties

Today many `get_*` tools return `[]` indistinguishably for "no data" vs "filter excluded everything" vs "auth scope missing". Phase 9 splits these:

- `empty_reason: "no_matches" | "scope_missing" | "integration_disconnected" | "out_of_window" | "permission_denied"`
- Tools refuse to return `[]` without one of these tags.
- The LLM is instructed: never say "you have no meetings" — say "no meetings in the window 2026-05-25 → 2026-06-01 from Google Calendar (Plaud not queried)".

## 9.3 Query echo + filter discipline

Every read tool must echo back:
- the resolved time window (with timezone),
- the resolved user id / project id,
- which integrations were and were NOT consulted.

This kills the most common silent-wrong: Duncan answers from Google Calendar when the user meant Plaud, or queries `now()` UTC when the user is in BST.

## 9.4 Cross-source reconciliation

For overlapping domains (meetings: Plaud + Meet + Calendar; tasks: Workstreams + Basecamp + DevOps), add a thin `reconcile_*` layer that:
- fetches from all relevant sources in parallel,
- deduplicates by stable keys (calendar event id, basecamp todo id, devops work item id),
- emits conflicts as `{ field, sources: [...], values: [...] }` rather than silently picking one.

LLM prompt: surface conflicts to the user, never paper over them.

## 9.5 Stale-cache and pagination hygiene

- Every cached read carries a TTL; expired reads are re-fetched, never served stale without a label.
- All list tools default to a hard cap (e.g. 50) and set `truncated: true` rather than silently dropping.
- Add `next_cursor` to every list tool; remove unbounded `LIMIT 1000` queries (Supabase default trap is documented in memory).

## 9.6 Identity & timezone resolution

Single resolver `_shared/identity.ts` that returns:
`{ user_id, profile_id, email, timezone, working_hours, manager_id }`

All read tools take this object — no more ad-hoc `auth.uid()` + UTC math scattered across 30 files. Eliminates the class of "wrong person / wrong day" errors.

## 9.7 Post-LLM correctness linter

A small deterministic pass between the model's draft answer and the SSE flush:

1. Extract every `[Source: …]`-style citation and every assertion that *looks* factual (regex for dates, names, counts, statuses).
2. For each, verify a matching `ReadResult` exists in this turn's tool log.
3. Unverifiable claims → either strip + replace with a hedge, or re-prompt the model with the violations.

Same shape as the Phase 6 typed-error guard, applied to reads.

## 9.8 Evaluation harness

`supabase/functions/norman-chat/correctness_eval.ts`:
- 50 golden prompts covering calendar, workstreams, recruitment, gmail, meetings, analytics.
- Each prompt has a fixture (frozen DB snapshot + frozen integration responses) and a rubric (must-cite, must-not-claim, must-hedge-if-missing).
- Runs in CI alongside `mutation_truth_test.ts`. Failing a rubric blocks deploy.

## 9.9 User-visible "show your working"

In the chat UI, attach a collapsible "Sources" panel to every assistant turn listing the `ReadResult` envelopes that backed the answer (source, fetched_at, row_count, filters). Users can spot wrong assumptions instantly — and so can we when triaging bug reports.

## 9.10 Roll-out order

1. Land `ReadResult` envelope + `empty_reason` taxonomy (no behaviour change yet).
2. Migrate the three highest-traffic read tools (`get_calendar_events`, `list_workstreams`, `search_meetings`) to emit it.
3. Ship the post-LLM correctness linter in shadow mode (logs violations, doesn't block).
4. Add the identity/timezone resolver and retrofit those three tools.
5. Add the eval harness with 10 prompts; expand to 50.
6. Flip the linter from shadow to enforcing.
7. Migrate remaining read tools in priority order.
8. Ship the "Sources" UI panel.

## Definition of done

- 100% of read tools return `ReadResult`.
- 0% of assistant turns contain factual claims without a matching `ReadResult` in the same turn (measured by the linter).
- Golden eval ≥ 90% pass rate, with hedging counted as correct when data is missing.
- "Sources" panel visible in production for every chat reply.

## Out of scope for Phase 9

- New integrations.
- LLM model swaps.
- Voice / mobile UI work.
- Anything mutation-side (Phases 1–8 already cover it).

## Decommissioned integrations (hard-negative)

The following systems are NOT pending migration targets. They are explicitly
decommissioned and must be treated as hard-negatives in the router, provenance
layer, and correctness linter. Any model attempt to cite them is an
`unbacked_claim` by definition.

- Basecamp
- Trello
- Asana
- Notion
- Xero
- Legal/NDA tools
- General Google Workspace (beyond the dedicated Gmail/Calendar/Drive paths)

Rule: the router must refuse to dispatch to these sources, and the linter must
flag any assistant turn that names them as a source.

## Remaining Phase 9 active read surfaces

Only these domains are still pending migration onto the ReadResult + identity/
window contract:

- Azure DevOps
- Hireflix
- Recruitment candidate reads
- RAG / project knowledge paths

## Roll-out (post-9.7)

1. Continue shadow-mode telemetry for 48–72h across the 6 already-migrated
   domains (Calendar, Workstreams, Team Availability, Gmail, Drive, Meetings).
2. Manually review real production conversations against shadow violations.
3. Flip selective enforcement on the migrated domains for **only**:
   `unbacked_claim`, `silent_empty`, `truncation_hidden`.
4. Then migrate the four remaining active surfaces above.
5. Expand enforcement to additional violation classes once telemetry supports it.

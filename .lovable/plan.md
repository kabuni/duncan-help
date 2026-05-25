# Duncan Production-Readiness Plan — Execution Truth & Routing Reliability

## Goal

Eliminate the class of failures where Duncan **claims success without verified execution** or **invents disconnected systems** instead of acting. After this plan, every tool call has a single canonical contract, every write is verified end-to-end, and the model is structurally unable to lie about outcomes.

The root cause is not any single bug — it is **architectural drift**: `norman-chat/index.ts` has grown to 6,730 lines with overlapping defensive layers, inconsistent tool-result shapes, a broken confirmation loop, and a too-tight tool-round budget. The plan below fixes the architecture, not the symptoms.

---

## Phase 1 — Canonical Tool-Result Envelope (foundation) ✅ SHIPPED

Every tool — read, write, pending, or error — returns the **same shape**. The model can then enforce truth with one rule instead of N idioms.

```ts
type ToolResult<T = unknown> = {
  ok: boolean;                  // did the tool achieve its stated effect?
  verified: boolean;            // for writes: did we re-read and confirm?
  status: "success" | "no_data" | "partial" | "pending_confirmation"
        | "error" | "timeout" | "circuit_open";
  source: string;               // e.g. "google_calendar", "workstream_cards"
  data?: T;                     // results / before-after / list payload
  error?: { code: string; message: string; retryable: boolean };
  pending?: { pendingId: string; summary: string };  // only when status=pending_confirmation
  meta?: Record<string, unknown>;
};
```

Rules:
- Read tools: `ok=true, verified=true, status="success"|"no_data"`.
- Write tools (direct execution): `ok` and `verified` reflect the post-write read-back.
- Write tools (confirmation path): `ok=false, verified=false, status="pending_confirmation"` — never "success".
- Errors: `ok=false, verified=false`, populated `error`.

Wrap every tool executor through a single `wrapToolResult()` helper so no tool can return a free-form shape.

---

## Phase 2 — Mutation Truth Rule that actually fires ✅ SHIPPED

Replace today's prose rule with a **structural** rule in the system prompt tied to the envelope:

> Before stating any write succeeded, you MUST have observed `ok=true AND verified=true` in the latest tool result for that operation. If `status="pending_confirmation"`, you MUST tell the user the action is awaiting their confirmation and not claim it is done. If `verified=false`, you MUST say it could not be confirmed and offer to retry.

Because every tool now returns the same fields, this rule is enforceable and testable.

---

## Phase 3 — Fix the calendar mutation path end-to-end ✅ SHIPPED

Two paths exist today (interceptor stub + `confirm-chat-write`) and neither closes the loop. Collapse to one flow:

1. `reschedule_event` / `create_event` / `cancel_event` executors:
   - Look up the event (fail loud if not found — never "optimistic success").
   - Perform the Google Calendar mutation.
   - **Re-read the event** from Google and diff against expected after-state.
   - Write an `event_mutation_audit` row: `{ user_id, tool, args, before, after, verified, error, request_id }`.
   - Return the canonical envelope with `before` / `after` in `data`.
2. `confirm-chat-write` invokes the **same executor** (shared module), then streams the canonical envelope back into the original chat thread via a new `duncan_event: "write_result"` SSE event. No more detached results.
3. Remove the silent "summary" string from the pending stub — it was being misread as a success claim.

---

## Phase 4 — Collapse defensive layers into one router ✅ SHIPPED

Today: `mustAskMeetingSource`, `shouldBypassTools`, `INTENT_RULES`, and the new entity resolver all bias behavior independently and contradict the act-first prompt. Replace with **one** deterministic router invoked once per turn:

```
classifyTurn(userMessage, history) →
  { intent: "read"|"write"|"chitchat",
    resolvedEntities: {...},
    requiredTools: [...],
    needsClarification: boolean,
    clarificationReason?: string }
```

Rules baked in:
- Single matching tool + matching enum → execute, never clarify.
- Disconnected systems (Basecamp/Trello/Jira/Asana/Monday/Notion-tasks) → never offer as alternatives.
- Genuinely ambiguous (no enum match, no tool match) → clarify with a specific question.

Delete `mustAskMeetingSource`, `shouldBypassTools`, and `INTENT_RULES`. The router is the only gate.

---

## Phase 5 — Raise `MAX_TOOL_ROUNDS` and add per-conversation state ✅ SHIPPED

- `MAX_TOOL_ROUNDS`: 2 → **6**. A correct write requires list → preview → execute → verify; 2 forces the model to skip verification.
- Per-conversation working memory (in-edge, derived from `chat_write_pending` + last N tool results) injected into the system prompt: pending writes, last tool results with `ok/verified`, resolved entities. When the user asks "did it work?", the model has a source of truth other than its own prior text.

---

## Phase 6 — Kill silent recovery paths

`recoverEmptyCompletion` currently re-invents truncated tool calls with no awareness of the confirmation contract. Replace with:
- On empty completion: return a typed error envelope to the client, surface a retry affordance. Never silently re-call write tools.
- Add a "no fabricated tool calls" invariant: a tool call must have originated from the streamed model output for this turn.

---

## Phase 7 — Observability & regression guardrails

- `event_mutation_audit` table (Phase 3) with RLS — admins can inspect every write attempt, before/after, verified flag, request_id.
- Structured `console.info` lines per turn: `{ turn_id, intent, tools_called, ok, verified, rounds }`.
- Deno tests for `norman-chat`:
  - "reschedule meeting" → executes, verifies, returns `ok=true, verified=true`.
  - "reschedule non-existent meeting" → returns `ok=false`, model says it failed.
  - "list Lightning Strike cards" → calls `list_workstream_cards` directly, no clarification.
  - "do it in Basecamp" → model states Basecamp is not connected.
  - Pending-confirmation path → model says "awaiting your confirmation", never "done".
- Manual QA matrix in `/release-manager` covering the same scenarios for each deploy.

---

## Phase 8 — Decompose the monolith (foundation for the future, not a blocker)

Split `norman-chat/index.ts` into:
- `_shared/router.ts` — Phase 4 classifier.
- `_shared/tools/` — one file per tool, each exporting `{ schema, execute }` returning the canonical envelope.
- `_shared/executors/calendar.ts`, `workstreams.ts`, … — shared between `norman-chat` and `confirm-chat-write`.
- `_shared/prompt/` — system prompt assembled from typed sections (truth rules, entity context, working memory).
- `index.ts` — thin orchestrator: auth → router → streamText loop → SSE.

This is the only way the next defensive rule won't land as another non-local override.

---

## Rollout order (each phase shippable independently)

1. Phase 1 + Phase 2 — envelope + truth rule. Low risk, high leverage.
2. Phase 3 — calendar verification + audit table. Fixes the Lightning Strike incident class.
3. Phase 5 — raise tool rounds + working memory.
4. Phase 4 — collapse defensive layers into the router.
5. Phase 6 — remove silent recovery.
6. Phase 7 — tests + observability (lands alongside each phase, finalised here).
7. Phase 8 — decomposition. Done last so prior phases ship fast.

---

## Technical notes

- **Files touched (initial phases):** `supabase/functions/norman-chat/index.ts`, `supabase/functions/confirm-chat-write/index.ts`, new `supabase/functions/_shared/*`, new migration for `event_mutation_audit`, new Deno test files under `supabase/functions/norman-chat/`.
- **Migrations:** `event_mutation_audit` table (RLS: admins read all, users read own); index on `(user_id, created_at desc)`.
- **No frontend changes** required for Phases 1–6 beyond rendering the new `write_result` SSE event in `useNormanChat.ts` (small addition to `handleDuncanEvent`).
- **Backwards compatibility:** envelope is additive; existing tool consumers keep working until each tool is migrated. Migrate read tools first (safest), then writes.
- **Risk:** medium. All changes are in the AI orchestration layer; no user data schema changes beyond an append-only audit table.

---

## Definition of "production ready"

- Every tool returns the canonical envelope.
- No write can be reported as successful without `ok=true AND verified=true`.
- Pending-confirmation writes are surfaced honestly in chat.
- No tool call exists that wasn't emitted by the model this turn.
- Router is the single source of clarification decisions.
- Test suite covers the four historical failure modes (false reschedule success, Basecamp hallucination, "did it work?" lie, recurring-event mis-edit).
- Audit table shows before/after for every calendar mutation in the last 30 days.

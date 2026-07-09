
## Goal

When a user submits a Feature Request, Duncan takes over end-to-end:
1. Reads the request, decides if it has enough detail.
2. If not, emails the requester with targeted clarifying questions (Gmail) and mirrors the thread in-app.
3. Once answered (or if already clear), scores it with a RICE-style rubric, writes a triaged spec, files a card on a dedicated **Product Backlog** workstream, and re-orders the backlog by priority score.
4. Notifies the requester + admins in-app when the ticket is filed.

Fully autonomous — no admin approval gate.

---

## User Journey

1. **Submit** — User fills the existing form at Settings → Request a Feature.
2. **Acknowledge** — Instant in-app notification: *"Duncan is reviewing your request."*
3. **Clarify (if needed)** — Duncan emails the requester 1–4 targeted questions from `duncan@kabuni.com`. Requester replies by email OR answers inline in a new **My Feature Requests** view. Up to 2 clarification rounds; then Duncan proceeds with best-effort assumptions.
4. **Triage** — Duncan produces: refined title, problem statement, proposed solution, acceptance criteria, RICE score, priority band (P0–P3), effort estimate (S/M/L/XL), category tag.
5. **File** — Card created in "Product Backlog" workstream, status = Yellow (Planned), assigned to Product owner (configurable), tagged with priority + category, linked back to `feature_requests.id`.
6. **Rank** — Backlog re-sorted by RICE score; card order stored on the card.
7. **Close loop** — Requester notified with the ticket link + estimated priority band.

---

## Architecture

### Schema changes (migration)

Extend `feature_requests`:
- `triage_status` text — `new | clarifying | triaged | filed | dismissed` (default `new`)
- `clarification_round` int default 0
- `rice_reach`, `rice_impact`, `rice_confidence`, `rice_effort` numeric
- `rice_score` numeric (generated: reach*impact*confidence/effort)
- `priority_band` text — `P0|P1|P2|P3`
- `effort_band` text — `S|M|L|XL`
- `category` text
- `refined_title`, `problem_statement`, `proposed_solution`, `acceptance_criteria` text
- `workstream_card_id` uuid → `workstream_cards.id`
- `email_thread_id` text (Gmail thread id for clarification)
- `last_agent_run_at` timestamptz

New table `feature_request_messages` (thread log):
- `id`, `feature_request_id`, `role` (`agent|user`), `channel` (`email|in_app`), `body`, `gmail_message_id?`, `created_at`
- RLS: requester + admins can read; only service role writes.

`app_settings` additions (single-row config, no schema change):
- `feature_request_backlog_workstream_id`
- `feature_request_default_assignee`
- `feature_request_sender_email` (default `duncan@kabuni.com`)

### Edge functions

1. **`feature-request-agent`** (main orchestrator) — invoked by:
   - DB trigger on `feature_requests` insert (via `pg_net`), OR simpler: called from the existing submit path in `SettingsFeatureRequest.tsx` after insert.
   - Cron every 10 min to sweep `triage_status IN ('new','clarifying')` that stalled.
   
   Logic (LLM via Lovable AI Gateway, `openai/gpt-5.5`, structured Output schema):
   - Load request + prior messages.
   - Decide `action ∈ {clarify, triage, dismiss}`.
   - If `clarify`: generate ≤4 questions, send Gmail via existing Gmail infra to requester email, log message, set status = `clarifying`, save `email_thread_id`.
   - If `triage`: generate refined fields + RICE scores + priority + effort. Persist. Create workstream card. Set status = `filed`. Send in-app notification + closing email.

2. **`feature-request-inbound`** — Gmail push/poll handler (piggybacks on existing recruitment Gmail poller pattern). Matches inbound replies by `email_thread_id`, appends to `feature_request_messages`, bumps `clarification_round`, re-invokes `feature-request-agent`.

3. **`feature-request-rerank`** — cron (hourly). Recomputes rank/order for all filed cards by `rice_score` and updates card `position` on the backlog workstream.

### Frontend

- **New page: `/feature-requests`** (accessible from Sidebar for all users)
  - "My Requests" tab: submitter sees own requests + Duncan's questions inline (answer here as alternative to email).
  - "All Requests" tab (admin only): full triage board grouped by `priority_band`, with RICE scores and links to the workstream card.
- **`FeatureRequestsAdmin.tsx`** (existing) — extended to show RICE, priority, linked card, thread log; add "Re-run triage" and "Dismiss" buttons.
- **`SettingsFeatureRequest.tsx`** — after submit, toast: *"Duncan is reviewing your request and will follow up by email if it needs more detail."*
- **`NotificationsBell`** — new notification types: `feature_request_clarify`, `feature_request_filed`.

### Backlog workstream

- On first run, `feature-request-agent` ensures a workstream named **"Product Backlog"** exists (create if missing) and stores its id in `app_settings.feature_request_backlog_workstream_id`.
- Cards use existing `workstream_cards` schema; RICE score stored as tag `RICE:<score>` for visibility; `position` column used for rank.

---

## Technical details

- **LLM**: `openai/gpt-5.5` via `_shared/ai-gateway.ts` with `Output.object` schema for triage. No schema bounds (per `ai-sdk-agent-patterns`); wrap in `NoObjectGeneratedError` fallback.
- **Email**: reuse existing Gmail sending path used by recruitment (`duncan@kabuni.com` centralized mailbox). Subject: `[Feature Request] <title>`. Replies threaded via `In-Reply-To` header.
- **Inbound polling**: extend existing recruitment Gmail poller with a second query filter (`subject:[Feature Request]`) OR add a dedicated poller cron.
- **Idempotency**: `feature-request-agent` uses `last_agent_run_at` and `fetch_locks` to prevent concurrent runs on the same request.
- **Auth**: Edge functions `verify_jwt = false`, use service role for DB writes, validate JWT for user-triggered calls.
- **Rate limits**: max 2 clarification rounds; then Duncan triages with best-effort and notes assumptions in the ticket.
- **RLS**: requesters read own rows; admins read all; agent writes as service role.

---

## Rollout plan

**Phase 1 — Core loop (this build)**
- Migration (schema extensions + new message table + RLS + grants).
- `feature-request-agent` edge function with clarify + triage + card creation.
- Wire submit path to invoke agent.
- Extend admin UI to show triage output.
- Notification hooks.

**Phase 2 — Inbound + rerank**
- `feature-request-inbound` Gmail poller.
- `feature-request-rerank` hourly cron.
- Public `/feature-requests` page with My Requests tab.

**Phase 3 — Polish**
- "Re-run triage" / "Dismiss" admin actions.
- Duplicate detection (embed refined_title, cosine match against existing filed requests, merge suggestion).
- Weekly digest of new backlog items to leadership.

---

## Open confirmations (non-blocking, sensible defaults chosen)

- Backlog workstream name: **"Product Backlog"** — auto-created if missing.
- Default assignee: first admin user unless configured in `app_settings`.
- Sender: `duncan@kabuni.com`.
- Clarification cap: **2 rounds**, then triage with assumptions noted.

# Meeting Notes Backfill + Weekly Action Rollup

## Goal

1. Scan **all** meeting notes Duncan's mailbox has ever received (Plaud, Gemini/Google Meet, Otter, Fireflies, Read.ai, generic `notes -` / "meeting notes" subjects), store them in the existing `meetings` table, and analyze each one.
2. When the user asks for action items from a specific meeting, Duncan also returns aggregated action items from all meetings in the **past 7 days** ending on that meeting's date.

## What already exists (reuse, don't rebuild)

- `meetings` table with `transcript`, `analysis`, `action_items`, `gmail_message_id` (used as dedupe key), `source`.
- `fetch-plaud-meetings` edge function — already polls Plaud / Nimesh / Patrick / Gemini notes for the last 60 days from `duncan@kabuni.com`.
- `analyze-meeting` edge function — runs GPT-4o analysis to populate `summary` / `action_items` / `analysis`.
- `norman-chat` exposes `list_meetings`, `get_meeting`, `analyze_meetings`, `search_meeting_transcripts`.

## Changes

### 1. New edge function: `backfill-duncan-meetings`
A one-shot (and re-runnable) full-history sweep of Duncan's Gmail using the existing `duncan_gmail_tokens`.

- Run a wider Gmail query, no `newer_than` cap, paginated until done:
  ```
  (from:plaud OR from:noreply@plaud.ai OR subject:"invited you to view"
   OR from:gemini-notes@google.com OR subject:"notes -"
   OR from:noreply@otter.ai OR from:fireflies.ai OR from:read.ai
   OR subject:"meeting notes" OR subject:"meeting summary"
   OR subject:"meeting recap" OR subject:"meeting transcript")
  ```
- For each message: skip if `gmail_message_id` already exists, otherwise extract subject / sender / date / body, classify `source` (`plaud` | `gemini` | `otter` | `fireflies` | `read` | `email`), and insert into `meetings`.
- Process Plaud "invited you to view" links the same way `fetch-plaud-meetings` already does (reuse the helper or import the logic).
- Use `EdgeRuntime.waitUntil` for the long-running loop; respond immediately with `{ started: true }`.
- After insert, enqueue `analyze-meeting` per batch of 10 ids so summaries/action items get populated.
- Idempotent: safe to re-run. Returns `{ inserted, skipped, analyzed_queued }`.

Trigger: admin-only button on the EA Inbox / Settings page, plus a manual chat command "backfill all meeting notes". No cron — it's a one-time historical sweep (existing `fetch-plaud-meetings` already handles ongoing 60-day polling).

### 2. New SQL helper + chat tool: weekly action-item rollup
Add a Postgres function `get_action_items_around(meeting_id uuid)` that returns action items from the target meeting plus all meetings in the 7 days before its `meeting_date`, scoped by the same RLS rules as `meetings`.

Expose in `norman-chat` as a new tool `get_meeting_action_items_with_context`:
- Input: `meeting_id` (and optional `days_back`, default 7).
- Output: `{ focus_meeting: {...}, related_meetings: [{title, date, action_items}], combined_action_items: [...] }`.
- Update the system prompt so that whenever the user asks "what are the action items from <meeting>" / "tasks from that meeting" / "follow-ups from <meeting>", Duncan calls this tool instead of `get_meeting`, and answers with two clearly labeled sections: **From this meeting** and **From the past 7 days**.

### 3. UI hook (small)
- EA Inbox page gets an admin-only "Backfill all meeting notes" button that invokes the new function and toasts progress, mirroring the existing "Poll now" button pattern.

## Technical notes

- All Gmail calls use the existing Duncan OAuth refresh-token flow (`duncan_gmail_tokens` + `GMAIL_CLIENT_ID/SECRET`).
- Analysis stays on `gpt-4o` via the existing `analyze-meeting` function — no new model wiring.
- No schema changes to `meetings` (existing columns cover everything). Only a new SQL function with `SECURITY DEFINER` + `search_path = public`.
- Dedupe stays on `gmail_message_id`.
- Times remain UTC in DB, formatted to Europe/London on display.

## Files

- `supabase/functions/backfill-duncan-meetings/index.ts` (new)
- `supabase/config.toml` (register function, `verify_jwt = false` + in-code admin check)
- `supabase/functions/norman-chat/index.ts` (new tool + prompt rules)
- `supabase/migrations/<ts>_action_items_rollup.sql` (new SQL function)
- `src/pages/EAInbox.tsx` (admin button)

## Out of scope

- Real-time push from Gmail (existing 5-min cron + manual button is enough).
- Changing the existing Plaud poller's 60-day window.
- Modifying RLS on `meetings`.

# Meetings into Projects — proposed schema

Approved architecture, revised for the conservative rules: one task system, new tasks only as suggestions, meeting source always visible, lightweight review strip, meaning over attendee overlap, and the agreed build order. Nothing here touches production; Gemini stays disconnected.

## What already exists (verified)

- `meetings` — title, `meeting_date`, transcript, summary, `action_items`, participants, `attendee_emails`, `host_user_id`, `source` (currently 'plaud').
- `workstream_cards` — the Areas of Work, each with `task_code` (WS-xxxx) and optional `project_id`.
- `workstream_tasks` — the single task system: title, description, `assignee_id`, `due_date`, `completed`, `completed_at`, `status`, `card_id`, `project_id`.
- `workstream_activity` — per-card history (`action`, `details` JSON, `user_id`).

No new task table is introduced. Everything below is additive.

## New records

### 1. `meeting_extractions` — what Duncan understood from a meeting

One row per suggestion or update Duncan derives from a transcript. This is a staging area, never a task list.

| Field | Purpose |
| --- | --- |
| `id` | identifier |
| `meeting_id` | the meeting it came from (cascade delete) |
| `kind` | `create_task`, `update_due_date`, `update_owner`, `complete_task`, `blocked`, `decision` |
| `status` | `pending`, `accepted`, `dismissed`, `auto_applied`, `undone` |
| `confidence` | `high`, `medium`, `low` |
| `project_id` | resolved Project, null when unresolved |
| `card_id` | resolved Area of Work, null when unresolved |
| `task_id` | matched existing task, null for a proposed new task |
| `proposed` | JSON: title, description, owner, due date, completion — the change being suggested |
| `source_quote` | the transcript line it came from |
| `reasoning` | short plain-English explanation of the match |
| `resolved_by`, `resolved_at` | who accepted, edited or dismissed it |
| `applied_task_id` | the task actually created or changed, for undo |
| `created_at` |

Access follows the Project: visible to people who can see the Project (`can_access_project`), plus admins. Only the backend extraction process writes rows; people change only `status` through accept/edit/dismiss.

### 2. `meeting_project_links` — which Project a meeting relates to

| Field | Purpose |
| --- | --- |
| `meeting_id`, `project_id` | the link (unique pair) |
| `card_id` | optional narrowing to one Area of Work |
| `confidence`, `reasoning` | why Duncan linked it |
| `link_source` | `duncan` or `manual` |
| `created_at` |

This is what keeps meeting context attached to a Project without turning discussion into tasks — the Project can show "3 meetings referenced this work" with the summary, while only genuine commitments reach the extraction table.

A meeting is never linked on attendee overlap alone: the link requires a meaning-level match (the Project, its Areas of Work or its active tasks are actually discussed). Overlap only raises confidence on an already-meaningful match. Below the threshold, no link is written and the suggestion waits for review.

### 3. Source reference on tasks

Two nullable columns on `workstream_tasks`:

- `source_meeting_id` — the meeting that created or last changed it
- `source_type` — `manual`, `meeting`, `chat`

Combined with the meeting's title and date, this gives every task row a readable origin: "From: Leadership Sync — 12 Sep". Duncan Chat uses the same columns with `source_type = 'chat'`, so both inputs land in one system.

### 4. Activity entries

Every auto-applied change writes a normal `workstream_activity` row on the card, with `details` carrying the meeting id, meeting title, date and the previous value — that previous value is what the one-click undo restores.

## How it connects

```text
meetings ──< meeting_project_links >── projects
    │                                     │
    └──< meeting_extractions >────────────┘
                 │  │
                 │  └── card_id  →  workstream_cards (Areas of Work)
                 └───── task_id  →  workstream_tasks (the one task system)
                                        │
                                        └── source_meeting_id → meetings
                                            workstream_activity (undo history)
```

## Behaviour rules baked into the data

- `kind = create_task` never auto-applies in this version; it is always `pending` until someone accepts.
- Auto-apply is limited to `update_due_date`, `update_owner` and `complete_task` at `high` confidence on a task the speaker owns.
- Completing someone else's task, cancellations, scope-changing decisions and anything at `medium` or `low` confidence stay `pending`.
- Dismissed rows are kept, so the same transcript line is not raised again.

## Project UI

One quiet strip on the Project — "From meetings — 3 updates" — listing each item in a line with Accept / Edit / Dismiss. No new navigation area, no second task list. Accepted items disappear into the existing task rows with their meeting reference attached.

## Build order

1. Read-only extraction over meetings already stored (nothing written to tasks).
2. Shared resolver for Project / Area / Task / Owner, used by meetings and Duncan Chat alike.
3. The review strip with Accept / Edit / Dismiss.
4. High-confidence automatic updates, with Activity entries and undo.
5. Gemini added as another transcript source — not now.

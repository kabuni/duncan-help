# Meetings into Projects — Phase 1 (read-only extraction)

Phase 1 only: create the staging tables, add the source columns, and build a read-only extraction step over meetings that are already stored. No task is created or changed. No production change. No Gemini.

## What you will see after Phase 1

Nothing changes in the Projects screens yet. Behind the scenes, Duncan reads meetings that are already in the system and writes down suggestions ("this looks like a new task", "this deadline seems to have moved") into a separate holding area. Every suggestion keeps the meeting name, date and the exact line it came from. Nothing is applied. The review strip that shows these suggestions comes in Phase 3.

## Database changes (shown here for approval before anything is applied)

### 1. `meeting_extractions` — staging only, never a task list

```sql
create table public.meeting_extractions (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  kind text not null check (kind in ('create_task','update_due_date','update_owner','complete_task','blocked','decision')),
  status text not null default 'pending'
    check (status in ('pending','accepted','dismissed','auto_applied','undone')),
  confidence text not null check (confidence in ('high','medium','low')),
  project_id uuid references public.projects(id) on delete set null,
  card_id uuid references public.workstream_cards(id) on delete set null,
  task_id uuid references public.workstream_tasks(id) on delete set null,
  proposed jsonb not null default '{}'::jsonb,
  source_quote text,
  reasoning text,
  resolved_by uuid references public.profiles(id) on delete set null,
  resolved_at timestamptz,
  applied_task_id uuid references public.workstream_tasks(id) on delete set null,
  created_at timestamptz not null default now()
);

grant select, update on public.meeting_extractions to authenticated; -- update limited to status by policy
grant all on public.meeting_extractions to service_role;
alter table public.meeting_extractions enable row level security;
```

Policies: SELECT for users who can reach the project (`public.can_access_project(project_id, auth.uid())`) or admins; UPDATE for the same set (used only to move `status` to accepted/dismissed); INSERT/DELETE reserved for the backend (`service_role`). Unique de-duplication index on `(meeting_id, kind, coalesce(task_id,'00000000-0000-0000-0000-000000000000'::uuid), md5(coalesce(source_quote,'')))` so a dismissed line is never suggested again.

`create_task` rows can only ever be written with `status = 'pending'` — enforced by a trigger, so no path can auto-create a task from a meeting.

### 2. `meeting_project_links`

```sql
create table public.meeting_project_links (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  card_id uuid references public.workstream_cards(id) on delete set null,
  confidence text not null check (confidence in ('high','medium','low')),
  reasoning text,
  link_source text not null default 'duncan' check (link_source in ('duncan','manual')),
  created_at timestamptz not null default now(),
  unique (meeting_id, project_id)
);
```
Same grant/RLS shape: readable by people who can access the project, written by the backend or by an explicit manual link.

### 3. Source columns on the existing task table (no new task table)

```sql
alter table public.workstream_tasks
  add column source_meeting_id uuid references public.meetings(id) on delete set null,
  add column source_type text not null default 'manual'
    check (source_type in ('manual','meeting','chat'));
```
Existing rows keep `manual`. Nothing else on the table is touched.

All of the above goes in one additive migration, `0009_meeting_extractions.sql`. No drops, no data edits, no production changes.

## Read-only extraction flow

New backend step `extract-meeting-updates`:

1. Takes a meeting id (or scans meetings with a transcript/summary that have no extractions yet).
2. Reads that meeting's existing `transcript`, `summary`, `action_items`, `participants`, `attendee_emails`, `host_email` — nothing new is fetched or stored about the meeting itself.
3. Asks GPT-4o for structured items only: kind, the exact quoted line, who it concerns, any date, and why. It is told to return nothing rather than guess.
4. Writes each item to `meeting_extractions` with `status = 'pending'`, plus a `meeting_project_links` row only where the content itself names or clearly concerns a project. Attendee overlap can raise confidence but never creates a link on its own.
5. Writes no tasks, changes no cards, applies nothing.

Resolution of project/area/task/owner is deliberately left shallow in Phase 1 (only obvious, explicitly-named matches); the shared resolver used by both meetings and Duncan Chat arrives in Phase 2, and unresolved rows are re-resolved then.

## Verification before I hand Phase 1 back

- Run the extraction over a handful of already-stored meetings and show you the rows produced: kind, confidence, quoted line, and what it matched.
- Confirm counts on `workstream_tasks`, `workstream_cards` and `workstream_activity` are unchanged.

## Out of scope for this phase

Shared resolver (Phase 2), review strip and Accept/Edit/Dismiss (Phase 3), auto-apply plus Activity and undo (Phase 4), Gemini (Phase 5). No Projects redesign, no Meetings navigation or tab, no second task list.

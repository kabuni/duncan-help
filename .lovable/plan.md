## Goal
Replace the single overwrite-only Notes field on each 90-Day deliverable with an append-only **update log** — every entry has an author, timestamp, message, and RYG status (Green/Amber/Red). The row surfaces the latest update inline; full history opens in a side drawer.

## Data model (new table)

`plan90_deliverable_updates`
- `deliverable_id` → `plan90_deliverables.id` (cascade delete)
- `author_id` → `auth.users.id`
- `author_name` (snapshot, so history survives if profile changes)
- `message` (text)
- `ryg` (enum: `green` | `amber` | `red`)
- standard `id`, `created_at`

RLS:
- **Read:** any authenticated `@kabuni.com` user (matches current Plan90 read model).
- **Insert:** authenticated users, author must be `auth.uid()`.
- **Update / Delete:** only the update's author, and only within 15 minutes of posting (small-edit window); admins can delete anything.

Realtime enabled on the table so the drawer and row preview update live.

The existing `plan90_deliverables.notes` column stays in the DB (dormant) — no data loss, no destructive migration. Existing notes are migrated once into the new log as a single "Imported note" entry attributed to a system author, so nothing appears to disappear.

## UI changes

### 1. On each deliverable row (replace the Notes icon)
New compact **Latest update cell**:

```text
● Green   "Draft signed off by Palash, moving to legal."   Tim · 2d ago
```

- Colored dot = RYG of latest update
- One-line truncated preview of latest message
- Author first name + relative time
- If no updates yet: muted "No updates" + "Add update" affordance for admins
- Whole cell is clickable → opens the Updates drawer

The Notes popover is removed. Attachments paperclip stays as-is.

### 2. Updates drawer (opens from the row)
Right-side sheet (matches existing Duncan sheet width), containing:

- **Header:** deliverable title + current status/priority badges
- **Composer (top, admins + assignees):** textarea + RYG selector + "Post update" button
- **Timeline (below):** newest first, each entry shows
  - Author avatar/initial + name
  - Relative timestamp (hover for exact)
  - RYG chip
  - Message body (wraps, preserves line breaks)
  - Edit / Delete icons (only within 15 min for author; admins can always delete)
- Empty state: "No updates yet — post the first one."

### 3. Overview tile (small addition)
Add a **RYG rollup** derived from each deliverable's latest update:

```text
Health · 12 Green · 5 Amber · 2 Red · 12 No update
```

This gives execs a health read that's independent of the Status column (Status = workflow state; RYG = subjective health).

## Files touched

**New**
- `src/components/plan90/DeliverableUpdatesDrawer.tsx` — sheet with composer + timeline
- `src/components/plan90/LatestUpdateCell.tsx` — inline row preview
- `src/hooks/usePlan90Updates.ts` — fetch, subscribe, post/edit/delete + latest-per-deliverable map

**Edited**
- `src/components/plan90/DeliverableRow.tsx` — swap Notes popover for `LatestUpdateCell`; wire drawer open
- `src/components/plan90/Plan90Overview.tsx` — add RYG health rollup tile row
- `src/hooks/usePlan90.ts` — expose latest-update map (or leave to new hook, imported alongside)

**Migration**
- Create table + grants + RLS + realtime publication
- One-time backfill: for every deliverable with a non-empty `notes`, insert one `plan90_deliverable_updates` row with `ryg='amber'`, `author_name='Imported note'`

## Out of scope (not doing)
- Not touching Status/Priority/Completion — RYG is a separate signal.
- No email/Slack notification on new updates (can add later if wanted).
- No @mentions in updates (can add later).
- No edits to attachments flow.
- Not removing the `notes` column (kept dormant to avoid data loss and let us roll back safely).

## Technical notes
- Latest-update lookup: single query `select distinct on (deliverable_id) …` ordered by `created_at desc`; kept as a `Map<deliverableId, Update>` in the hook, fed to both the row preview and the overview rollup.
- Realtime: one channel subscribed to `plan90_deliverable_updates` refetches the latest-per-deliverable map on any change.
- RYG stored as a Postgres enum for integrity; UI maps it to existing amber/emerald/red Tailwind tokens already used on the page.
- 15-minute author-edit window enforced in RLS via `created_at > now() - interval '15 minutes'` so the client can't bypass it.

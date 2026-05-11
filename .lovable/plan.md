## Goal
Let event creators add additional people (beyond the single Owner) who play a role on a Planner event — e.g. a Designer + Copywriter on a Creative event, or a Producer + Host on a Marketing event. Each collaborator has a free-text role label.

## UX

**Add Event dialog** — new section under Owner, before Time zone:

```text
Collaborators (optional)
┌──────────────────────────────────────────────┐
│ [Person ▼]   [Role e.g. Designer]   [+ Add]  │
├──────────────────────────────────────────────┤
│ • Sarah Chen — Designer              [×]     │
│ • Mike Patel — Copy                  [×]     │
└──────────────────────────────────────────────┘
```

- Person picker reuses the same approved-profiles list as Owner.
- Role is a free-text input (no preset list, works for every category).
- Multiple collaborators allowed, deduped by person.
- Owner is excluded from the picker (they're already accountable).

**Detail drawer** — new "Collaborators" section showing avatar + name + role chip for each person.

**Calendar tooltip** — append a compact line: `+ 2 collaborators: Sarah (Designer), Mike (Copy)`.

## Data

Add a single column to `key_events`:

```sql
ALTER TABLE public.key_events
  ADD COLUMN collaborators jsonb NOT NULL DEFAULT '[]';
-- shape: [{ "profile_id": "uuid", "display_name": "Sarah Chen", "role": "Designer" }]
```

Reasons for jsonb (vs new join table):
- Matches existing pattern (`attendees`, `linked_docs` are already jsonb on this table).
- No RLS surface to design — inherits `key_events` policies.
- Reads in one query alongside the event.

## Files to change

1. **Migration** — add `collaborators` jsonb column.
2. **`src/components/diary/AddEventDialog.tsx`**
   - Add `collaborators` to draft state.
   - New "Collaborators" UI block (person Select + role Input + Add button + list with remove).
   - Include `collaborators` in the `key_events` insert.
3. **`src/components/diary/DetailDrawer.tsx`** — render collaborators section; allow add/remove if user can edit the event (mirror existing edit affordances).
4. **Calendar event tooltip** — wherever tooltip text is composed for events (likely in the page that renders FullCalendar / list view), append the collaborators line. *(Will locate during implementation — `src/pages/KeyEventsDiary.tsx` is the entry point.)*
5. **`src/integrations/supabase/types.ts`** auto-regenerates after the migration.

## Out of scope
- No notifications to collaborators (separate decision; can be a follow-up).
- No category-specific role presets — kept fully free-text per your choice.
- Owner field stays as-is (single accountable person).

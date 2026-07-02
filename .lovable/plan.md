
# Planner Approval Color Coding — Technical Breakdown

This is a research answer, not an implementation task. No files will be changed. If you want any of this actually modified (e.g. optimistic amber-on-save), tell me and I'll add build steps.

## 1. The color function (`eventPropGetter`)

`src/pages/KeyEventsDiary.tsx` L359–392, passed to `<Calendar eventPropGetter={eventPropGetter}>` at L625.

```ts
const eventPropGetter = (item: CalItem) => {
  const ev = item.resource.data;
  const isPublicHoliday = ev.category === "PublicHoliday";
  const colorKey = isPublicHoliday
    ? "holiday"
    : ev.approval_state === "pending"
    ? "amber"
    : ev.approval_state === "approved"
    ? "green"
    : ev.risk_level;                    // fallback: "green" | "amber" | "red"
  const meta = getCategoryMeta(ev.category);
  const className = `evt-${colorKey}`;
  return {
    className,
    style: { ["--cat-color" as any]: meta.hsl } as React.CSSProperties,
  };
};
```

Priority chain: PublicHoliday → approval_state (pending/approved) → `risk_level`. Rejected events never render because they're filtered out at query time (see §2).

## 2. Where `approval_state` comes from

It is a **real column on `key_events`**, not derived at render.

- Type: `src/hooks/useKeyEvents.ts` L33 — `approval_state: "pending" | "approved" | "rejected" | null` on the `KeyEvent` interface.
- Fetched via `select("*")` in `useKeyEvents.refresh()` L85–90, with a filter that drops rejected rows:
  ```ts
  .from("key_events")
  .select("*")
  .eq("deleted_in_google", false)
  .or("approval_state.is.null,approval_state.neq.rejected")
  ```
- The value is maintained server-side by the DB trigger `sync_event_approval_state()` on `key_event_approvals` (documented earlier in this conversation): when approval rows change, it recomputes and writes `pending` / `approved` / `rejected` back onto the parent `key_events` row. The frontend never derives it from the approvals list.

## 3. What triggers re-render after an approval change

Two paths, both in `src/hooks/useKeyEvents.ts` L121–138:

1. **Realtime** — a Supabase channel `planner-key-events` subscribes to `postgres_changes` on both `key_events` and `key_event_approvals`. Any INSERT/UPDATE/DELETE fires `refresh()`, which re-runs the parallel select and calls `setEvents(...)`, causing the calendar to re-render with the new `approval_state`.
2. **Manual** — `EventApprovals.tsx` (approve/reject buttons) mutates `key_event_approvals`; the DB trigger updates `key_events.approval_state`; realtime delivers both changes; `refresh()` fires.

There is no optimistic update and no React Query cache — it's plain `useState` + refetch.

## 4. When does a new event turn amber?

Not immediately, and not on save of the event itself. Sequence in `src/components/diary/AddEventDialog.tsx` L260–330:

1. Insert into `key_events` with `approval_state: isPublicHoliday ? "approved" : null` (L286). At this instant a non-holiday event is **null → colored by `risk_level` (default `"green"`)**.
2. Insert the selected approver row(s) into `key_event_approvals` (L317–328).
3. The DB trigger `sync_event_approval_state()` sees the new pending approval row and updates `key_events.approval_state = 'pending'`.
4. Realtime pushes that UPDATE → `refresh()` → event re-renders **amber**.

So the amber transition is backend-confirmed, typically within a few hundred ms of save. There is a brief window where the event is green.

## 5. `KeyEvent` interface (approval_state is a field)

`src/hooks/useKeyEvents.ts` L4–41 — abbreviated to the relevant parts:

```ts
export interface KeyEvent {
  id: string;
  google_event_id: string;
  title: string;
  event_name: string | null;
  category: string | null;
  start_at: string | null;
  end_at: string | null;
  all_day: boolean;
  owner: string | null;
  collaborators: { profile_id: string | null; display_name: string; role: string }[];
  missing_fields: string[];
  is_complete: boolean;
  risk_level: "green" | "amber" | "red";
  risk_reason: string | null;
  approval_state: "pending" | "approved" | "rejected" | null;   // ← the field
  holiday_region: string | null;
  linked_goal_ids: string[];
  deleted_in_google: boolean;
  synced_at: string;
  created_by: string | null;
  // ...plus title/description/link/status/objective/etc.
}
```

## 6. Exact CSS for each color

`src/components/diary/calendar.css` L133–141:

```css
/* Risk level coloring */
.rbc-event.evt-green   { background: hsl(142 70% 45% / 0.22); color: hsl(142 70% 28%); }
.rbc-event.evt-amber   { background: hsl(38 95% 50% / 0.22);  color: hsl(38 95% 35%); }
.rbc-event.evt-red     { background: hsl(0 80% 55% / 0.18);   color: hsl(0 80% 45%); }
.rbc-event.evt-holiday { background: hsl(215 90% 55% / 0.18); color: hsl(215 90% 35%);
                         border-left-color: hsl(215 90% 55%); }
.dark .rbc-event.evt-green   { color: hsl(142 70% 70%); }
.dark .rbc-event.evt-amber   { color: hsl(38 95% 65%); }
.dark .rbc-event.evt-red     { color: hsl(0 85% 75%); }
.dark .rbc-event.evt-holiday { color: hsl(215 90% 78%); }
```

Base `.rbc-event` (L113–122) adds a 3px left border driven by `--cat-color` (category color, independent of approval color).

## Summary of the answer

- Color = `evt-${colorKey}` from `eventPropGetter` in `KeyEventsDiary.tsx`.
- `approval_state` is a column on `key_events`, filtered so rejected rows never load.
- Refresh is Supabase realtime on `key_events` + `key_event_approvals` → `refresh()` refetch (no optimistic UI).
- New non-holiday events are saved with `approval_state = null` (renders green), then flip to amber once the approval row insert triggers `sync_event_approval_state()` and realtime delivers the update.
- Green/amber/red/holiday are four static CSS classes in `calendar.css` L134–141.

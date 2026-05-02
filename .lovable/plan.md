## Problem

When a card's overall status is `not_started`, the kanban card shows a blue dot and the detail modal shows the raw text `not_started`. The neutral "Not started" state isn't visually distinct from "done" and the label looks unfinished.

## Changes

**1. `src/components/workstreams/KanbanBoard.tsx` — `OverallDot`**
- Map `not_started` to a neutral grey dot (`bg-muted-foreground/50`), keep `done` on `bg-primary`.
- Improve tooltip label: show "Not started" / "Yellow" instead of raw enum.

**2. `src/components/workstreams/CardDetailModal.tsx` — Overall badge (lines 189–207)**
- Add a `not_started` branch: grey dot + label "Not started".
- Keep existing red/amber/green/done logic untouched.

## Result

Cards with overall status `not_started` now display a clear grey dot with the label "Not started" everywhere — kanban tile tooltip and detail modal — matching the existing red / yellow / green / done treatment.

No DB or hook changes needed; status is already supported end-to-end.

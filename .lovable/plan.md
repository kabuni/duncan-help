## Goal

On the Workstreams kanban cards, the "Overall" pill currently shows R / Y / G / ✓ counts but skips tasks in **Not started** state. On the **Show Production** card you can see `1R 3Y` but the remaining 1 task (Not started) is invisible. We'll surface it as `1NS` so the breakdown always reconciles to the total.

## Changes

### 1. `src/hooks/useWorkstreams.ts`
- Extend `TaskBreakdown` interface with `not_started: number`.
- Update `getTaskBreakdown()` to count `not_started` tasks instead of dropping them (currently the comment literally says "not_started excluded from RYG breakdown — neutral").
- Initialise `{ red: 0, yellow: 0, green: 0, done: 0, not_started: 0 }`.

### 2. `src/components/workstreams/KanbanBoard.tsx` (card breakdown line, ~L130–139)
- Add a neutral-grey segment for not started, rendered first so it reads `1NS 1R 3Y`:
  ```tsx
  {card.task_breakdown.not_started > 0 && (
    <span className="text-muted-foreground">{card.task_breakdown.not_started}NS </span>
  )}
  ```
- Keep existing R/Y/G/✓ segments unchanged.

### 3. `src/components/workstreams/CardDetailModal.tsx` (~L204)
- Update the inline summary to include NS:
  `· {ns}NS/{red}R/{yellow}Y/{green}G/{done}✓` (only show NS portion when > 0, or always — match card behaviour: omit when zero).

### 4. Visibility guard
- The current guard `card.tasks_total! > 0 && card.overall_status` already covers cards that have tasks, including all-not-started cards (overall_status returns `"not_started"`). No change needed — but verify the OverallDot already renders for `not_started` (it does, from the previous fix).

## Result

Show Production will display: `Overall ● 1NS 1R 3Y` (5 tasks total, matching `0/5`).

## Out of scope

- No DB or schema changes.
- No changes to sorting, filtering, or status logic.

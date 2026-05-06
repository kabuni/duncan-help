## Issue

The Planning checklist (`src/components/projects/PlanningChecklist.tsx`) sits above the chat messages inside the center column of `ProjectWorkspace.tsx`. The center column is `flex-1 ... overflow-hidden`, but the checklist's expanded content (`<div className="px-3 pb-3 space-y-2">` at line 266) has no max-height or overflow rule. When many items are added, the list keeps growing and pushes the chat down — and because its parent clips overflow, you can't scroll inside the checklist to reach lower items.

## Root Cause

`PlanningChecklist` renders inline as a static block with no scroll container. The only scroller is the messages area below it.

## Fix (frontend only, single file)

In `src/components/projects/PlanningChecklist.tsx`:

- Wrap (or update) the expanded body so it has a bounded height and its own scrollbar:
  - Change line 266 `<div className="px-3 pb-3 space-y-2">` to `<div className="px-3 pb-3 space-y-2 max-h-[40vh] overflow-y-auto overscroll-contain">`.
- Keep the quick-add row (Group / title input / Add button) visible by moving it OUT of the scroll area into a sibling block that stays pinned below the scrollable list, so users can always add new items even when the list is long.

Resulting structure inside `{open && (...)}`:

```text
<div>  // wrapper (no scroll)
  <div class="max-h-[40vh] overflow-y-auto overscroll-contain px-3 pt-2 space-y-2">
     ...loading / suggested / groupedAccepted...
  </div>
  <div class="px-3 pb-3 pt-2 border-t border-border/50">
     ...quick-add inputs + Add button...
  </div>
</div>
```

## Out of scope

- No schema, hook, or business-logic changes.
- No changes to `ProjectWorkspace.tsx` layout.
- No restyling beyond the scroll container and a thin divider above the quick-add row.

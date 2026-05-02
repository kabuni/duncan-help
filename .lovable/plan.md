## Problem

In the Project chat's Planning Checklist, the "done" checkbox can't be ticked — especially on mobile (current viewport 430px). Two underlying causes:

1. **Tiny tap target.** The checkbox is rendered at `h-3.5 w-3.5` (14px) inside a tightly packed row. On a touch screen, taps almost always land on the adjacent title `<Input>` instead, which just focuses the input. Apple/Google guidance is a 44x44px minimum target.
2. **Indicator clipping.** The shadcn `Checkbox` ships a 16px `Check` icon, but we shrink the box to 14px, so the tick icon overflows and on some renders the click hit-area is reduced to a sliver.
3. (Minor) A `forwardRef` warning is logged because `AssigneePicker` is used as a `PopoverTrigger asChild` child without `forwardRef`. Not the cause of this bug, but worth fixing while in the file.

## Fix

In `src/components/projects/PlanningChecklist.tsx` (the `PlanRow` component):

- Wrap the `Checkbox` in a `<label>` with padding so the tap target is ~28-32px on mobile (`p-1.5`), and the entire padded area toggles the checkbox. This keeps the visual size small but makes it easy to hit with a finger.
- Bump the checkbox itself to `h-4 w-4` so it matches the bundled tick icon and renders cleanly.
- Stop the title `<Input>` from stealing the tap by giving the checkbox label `shrink-0` and ensuring it sits flush left with no negative margin.
- Wrap `AssigneePicker` in `React.forwardRef` to silence the console warning and ensure Radix Popover anchoring works reliably.

No database, RLS, or schema changes — RLS on `project_chat_plan_items` already allows project members to update.

## Files to edit

- `src/components/projects/PlanningChecklist.tsx` — `PlanRow` checkbox wrapper + sizing; `AssigneePicker` `forwardRef`.

## Acceptance

- Tapping the checkbox (or the padded area around it) on mobile reliably toggles done/undone.
- Title input no longer "absorbs" taps meant for the checkbox.
- No more `forwardRef` warning in the console for `PlanRow`/`AssigneePicker`.

## Goal
Reduce visual clutter on the Planner (`/diary`) category filter bar by grouping chips into four labelled clusters and tightening the layout. Also rename a few labels and add two new categories.

## Category groups (display order)

- **People** — Travel, Annual Leave (was Holiday), Global All Hands *(new)*, Team Socials *(new)*
- **Operations** — Product, Releases, Event, Super Coaches, Investor
- **Marketing** — Social Media (was Social), PR, Launches (was Launch)
- **Other** — Marketing (legacy parent), Operations (legacy parent), Communication, Creative — kept so historic events still filter, shown muted at the end

Underlying keys are unchanged (`Holiday`, `Social`, `Launch`, etc.) so existing events keep their colors and remain filterable. Two new keys are added: `GlobalAllHands` and `TeamSocials`.

## Files to change

1. **`src/components/diary/categoryMeta.ts`**
   - Update labels: `Holiday → "Annual Leave"`, `Social → "Social Media"`, `Launch → "Launches"`.
   - Add `GlobalAllHands` (icon 🌐, hsl `215 70% 50%`) and `TeamSocials` (icon 🥂, hsl `300 65% 55%`).
   - Export a new ordered grouping structure used by the legend:
     ```ts
     export const CATEGORY_GROUPS: { label: string; keys: string[] }[] = [
       { label: "People",     keys: ["Travel","Holiday","GlobalAllHands","TeamSocials"] },
       { label: "Operations", keys: ["Product","Releases","Event","Super Coaches","Investor"] },
       { label: "Marketing",  keys: ["Social","PR","Launch"] },
       { label: "Other",      keys: ["Marketing","Operations","Communication","Creative"] },
     ];
     ```
   - Keep `CATEGORY_META`, `CATEGORY_LIST`, and `getCategoryMeta` working as before.

2. **`src/pages/KeyEventsDiary.tsx`** (lines ~434–472)
   - Replace the flat `Object.entries(CATEGORY_META).map(...)` legend with a grouped layout:
     - Iterate `CATEGORY_GROUPS`. Each group renders a small uppercase label (matching the existing `font-mono uppercase tracking-wider text-[10px] text-muted-foreground` style) followed by its chips.
     - Groups separated by a thin vertical divider (`<span className="h-3 w-px bg-border/60 mx-1" />`) on `sm+`; on mobile they stack into rows.
     - "Other" group renders with `opacity-70` and smaller text to de-emphasise legacy chips.
   - Tighten chip styling for less clutter:
     - Drop the colored swatch square (`<span className="h-2 w-2 ...">`) — the emoji + ring already convey color.
     - Reduce gap to `gap-x-1.5 gap-y-1`, padding to `px-1.5`, border radius unchanged.
   - Keep `toggleCategory`, active/inactive states, and the existing "Clear" pill unchanged.
   - The `AddEventDialog` category dropdown should also reflect the new grouping; update its category source to render `<optgroup>` (or shadcn `SelectGroup`) per `CATEGORY_GROUPS`.

3. **`src/components/diary/AddEventDialog.tsx`**
   - Switch the category picker from a flat list to grouped options using `CATEGORY_GROUPS`, so new events can be tagged `GlobalAllHands` / `TeamSocials`.
   - No schema change — `category` remains a free-text column.

## Out of scope
- No DB migration; legacy events tagged `Holiday`, `Social`, `Launch` keep their stored key and just display under the new label.
- No automatic re-tagging of existing events into the new keys (`GlobalAllHands`, `TeamSocials`).
- `DetailDrawer.tsx` continues using `getCategoryMeta` and needs no change.

## Visual sketch
```text
Categories
  People       ✈️ Travel   🏖️ Annual Leave   🌐 Global All Hands   🥂 Team Socials
  Operations   🛠️ Product   📦 Releases   📌 Event   🏆 Super Coaches   💼 Investor
  Marketing    📱 Social Media   📰 PR   🚀 Launches
  Other (faded)  Marketing · Operations · Communication · Creative           [Clear]
```

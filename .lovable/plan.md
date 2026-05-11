## Goal

Stop the Operations Release dropdown from showing `June 7 - KPL` (and any other unused picklist values that still live in the Azure Boards process definition).

## Root cause

In `src/pages/Operations.tsx` the dropdown options are built from two sources:

1. `getRelease(w)` across visible work items (correct — only shows in-use values).
2. `releaseMeta.allowedValues` — every value defined in the Azure picklist, merged in via `(releaseMeta?.allowedValues || []).forEach((v) => v && releases.add(v));` (line 167).

Source #2 is what surfaces `June 7 - KPL` even though no work item references it. Cache time (10 min `staleTime`) is irrelevant — Azure itself still returns the duplicate.

## Change

In `src/pages/Operations.tsx`:

1. **Remove the picklist merge** (line 167) so `filterOptions.releases` is built purely from `getRelease(w)` over the current project's items.
2. **Remove the now-unused `useQuery` for `azure-release-options`** (lines 116–127) and drop `releaseMeta` from the `useMemo` dependency list (line 175).
3. **Keep `defaultRelease` behaviour** by hardcoding it to `"Future"` (the field's actual default in Azure) inside `getRelease`, so unset User Stories still bucket under `Future` matching Azure's UI. Same line 142 logic, just sourced from a constant instead of `releaseMeta`.

## Result

- Dropdown will only contain release values present on at least one synced work item in the selected project (currently just `Future`).
- `June 7 - KPL` and any future orphaned picklist entries are invisible to users.
- One fewer Edge Function call on every Operations page load.

## Out of scope

- The duplicate `7 June - KPL` / `June 7 - KPL` entry in Azure Boards itself remains — an admin can clean that up in Azure later, but Duncan no longer surfaces it.

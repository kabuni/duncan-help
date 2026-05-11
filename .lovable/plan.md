## Add a Release filter to Operations → Work Items

Add a fifth dropdown filter alongside State, Type, Assignee, and Project on the Operations page work items table. Release values come from the Azure DevOps Planning section on each user story / task — i.e. the work item's **Iteration Path** (`System.IterationPath`), which is the field Azure Boards' Planning panel writes to.

### Source of "Release"

- Field: `azure_work_items.iteration_path` (already synced from `System.IterationPath`).
- Display value: the leaf segment after the last `\` (e.g. `duncan\Sprint 9` → `Sprint 9`); items with no leaf fall back to the full path; items with no iteration_path are bucketed as `No release`.
- Project-aware: only show release options that exist for the current Project filter selection (so picking a project narrows the release list to that project's iterations).

### Changes (frontend only)

File: `src/pages/Operations.tsx`

1. Add state: `const [releaseFilter, setReleaseFilter] = useState<string>("all");`.
2. Add helper `getRelease(w)`: returns leaf of `iteration_path`, or `null` if missing.
3. Extend `filterOptions` to compute `releases` — unique sorted set of `getRelease` values, scoped to the currently active `projectFilter` (so the release dropdown updates when project changes).
4. Extend `filteredItems` to apply the release filter (`"all"` | `"__none__"` | specific value).
5. Render a new `<Select>` after the Projects filter, matching styling (`h-9 w-[160px] text-xs`):
   - `All releases`
   - `No release`
   - …discovered releases.
6. Reset `releaseFilter` to `"all"` when `projectFilter` changes (so a stale release from another project doesn't hide all rows).

### Out of scope

- No backend, schema, or sync changes — `iteration_path` is already stored.
- No changes to the Repos tab or Sync Logs section.
- No persistence of filter state across reloads.

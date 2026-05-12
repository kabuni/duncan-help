## Problem

The Team Briefing's Azure Repos card already has UI to show developer-level contributions, top contributor, lines changed, and week-over-week trend (in `CommsPulseCard.tsx` → `AzureReposSection`). The `azure-repos-api` edge function already computes all of these (`contributors_7d`, `top_contributor`, `prev_window`, `wow`) in its `briefing_summary` action.

The data is being **dropped in transit** by `ceo-briefing/index.ts`:

1. `normalizeExternalSignal` (lines 1312-1337) only retains keys listed in `defaults` — `contributors_7d`, `top_contributor`, `prev_window`, `wow` are not in defaults, so they are stripped.
2. The final `parsed.payload.azure_repos_signal = { ... }` object (lines 3781-3802) only echoes a fixed set of fields — same four are missing.

That's why the contributor table, top-contributor line, and WoW trend chips never render.

## Fix

Forward the missing fields through `ceo-briefing` end-to-end so the existing UI lights up. No UI changes needed.

### supabase/functions/ceo-briefing/index.ts

1. Extend the `normalizedAzureReposSignal` defaults block (around line 1357) to include:
   - `contributors_7d: []`
   - `top_contributor: null`
   - `prev_window: null`
   - `wow: null`
   - `scanned_projects: []`
   - `scanned_repos: []`
   
   This way `normalizeExternalSignal` preserves them when the upstream signal supplies them.

2. Extend the final `parsed.payload.azure_repos_signal` assembly (around lines 3781-3802) to add:
   - `contributors_7d: (normalizedAzureReposSignal as any).contributors_7d`
   - `top_contributor: (normalizedAzureReposSignal as any).top_contributor`
   - `prev_window: (normalizedAzureReposSignal as any).prev_window`
   - `wow: (normalizedAzureReposSignal as any).wow`

3. Deploy `ceo-briefing` after the edit.

### Verification

- Regenerate the Team Briefing as an admin user.
- Confirm the Azure Repos card now shows: top contributor line, contributor table (commits, lines changed, trend chip per author), and the WoW trend sentence ("Activity is increasing/slowing …").
- Check `supabase--edge_function_logs` for `azure-repos-api` and `ceo-briefing` to ensure no new errors.

## Out of scope

- The card UI itself (already built).
- Backend metric computation (already implemented in `azure-repos-api`).
- Adding new metrics beyond what the user listed (lines, top contributor, WoW, trend, per-developer). Everything they asked for is already produced upstream.
## Root cause

The Azure Repos card in Team Briefing renders four "0" metrics — Commits 7d, Files added 7d, Files removed 7d, Contributors 7d — even though the underlying `azure-repos-api` edge function (`action: briefing_summary`) computes and returns them correctly.

The metrics are dropped in two places inside `supabase/functions/ceo-briefing/index.ts`:

1. **`normalizeExternalSignal` defaults (line ~1357).** Only PR-related fields are listed in the `defaults` dict for the Azure Repos signal (`repos_scanned`, `open_prs`, `blocked_prs`, `stale_prs`, `release_risks`). The normalizer uses `Object.fromEntries(Object.keys(defaults)...)` to copy fields from the raw signal, so any field not in `defaults` is discarded. The four commit metrics are therefore lost before normalization.

2. **`payload.azure_repos_signal` builder (line ~3777).** This object explicitly enumerates the fields written to the briefing payload (and ultimately stored in `ceo_briefings`). The commit metrics aren't enumerated, so even if step 1 were fixed they still wouldn't reach the saved payload that the frontend reads via `useCEOBriefing` / `CommsPulseCard`.

The frontend (`src/components/ceo/CommsPulseCard.tsx` lines 890-893) reads `azureReposSignal.commits_7d`, `files_added_7d`, `files_removed_7d`, `active_contributors_7d`, all of which arrive as `undefined` and render as `0`.

## Fix

Edit `supabase/functions/ceo-briefing/index.ts`:

1. Extend the `defaults` object in the `normalizeExternalSignal` call for Azure Repos (around line 1357) to include:
   - `commits_7d: 0`
   - `files_added_7d: 0`
   - `files_removed_7d: 0`
   - `active_contributors_7d: 0`

2. Extend the `parsed.payload.azure_repos_signal = { ... }` block (around line 3777) to also write these four fields from `normalizedAzureReposSignal`.

Also update the human-readable `metrics_summary` template (line 1364) to mention the commit signal so the AI summary text reflects engineering velocity, e.g. append `· {commits_7d} commits / {active_contributors_7d} contributors (7d)`.

## Deployment & verification

- Redeploy the `ceo-briefing` edge function.
- Ask the user to regenerate the Team Briefing.
- Confirm the Azure Repos card shows non-zero values for Commits 7d / Files added / Files removed / Contributors 7d (assuming activity exists in the last 7 days).

## Files touched

- `supabase/functions/ceo-briefing/index.ts` — two small edits described above.

No frontend, schema, or other edge function changes required.

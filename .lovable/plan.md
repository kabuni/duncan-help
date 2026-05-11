## Goal
Enhance the **Azure Repos card** on the Team Briefing (`/team-briefing`, rendered by `CommsPulseCard.tsx` → `azureReposSignal`) with contributor-level insights, week-over-week comparison, and a trend indicator.

## What will change

### 1. Backend — `supabase/functions/azure-repos-api/index.ts` (`briefing_summary` action)

Today this action only returns aggregate 7-day counters (`commits_7d`, `files_added_7d`, `files_removed_7d`, `active_contributors_7d`). We will extend it to also compute:

- **Per-contributor breakdown (last 7d)** — for every commit author across all scanned repos:
  - `commits` count
  - `files_added`, `files_edited`, `files_removed` (from Azure's `commit.changeCounts`)
  - `lines_changed` proxy = `Add + Edit + Delete` file counts (Azure DevOps does **not** return line diffs on the commits list — see "Technical notes" below for the trade-off and an optional deeper-fetch mode)
  - `repos` they touched
- **Top contributor** — the author with the most commits in the last 7d (with a tie-break on lines_changed).
- **Previous-week metrics (days 8–14)** — re-scan the same repos with `fromDate = now-14d` and `toDate = now-7d` and compute the same totals: `commits_prev_7d`, `files_added_prev_7d`, `files_removed_prev_7d`, `active_contributors_prev_7d`.
- **Week-over-week deltas & trend**:
  - Absolute deltas + % change for each metric.
  - `trend`: `"up" | "down" | "flat"` derived from the commits delta (threshold ±5%).
- **Per-contributor WoW delta** — same `commits` count for each author in the prior week, plus a per-author `trend` flag so the UI can show ▲ / ▼ / – next to each name.

New shape appended to the existing `result` object:

```ts
contributors_7d: Array<{
  author: string;
  email?: string;
  commits: number;
  files_added: number;
  files_edited: number;
  files_removed: number;
  lines_changed: number;       // proxy (file-change count) unless deep_diff=true
  repos: string[];
  commits_prev_7d: number;
  trend: "up" | "down" | "flat";
}>;
top_contributor: { author: string; commits: number; lines_changed: number } | null;
prev_window: {
  commits_7d: number;
  files_added_7d: number;
  files_removed_7d: number;
  active_contributors_7d: number;
  since: string;
  until: string;
};
wow: {
  commits_delta: number; commits_pct: number;
  files_added_delta: number; files_added_pct: number;
  files_removed_delta: number; files_removed_pct: number;
  contributors_delta: number;
  trend: "up" | "down" | "flat";
};
```

The existing fields stay untouched — fully backward-compatible.

### 2. Type surface

- Extend the `azureReposSignal` interface in `src/components/ceo/CommsPulseCard.tsx` (lines ~108–129) with the new optional fields above.
- The `ceo-briefing` function already forwards the raw `azure-repos-api` response into `azure_repos_signal`, so no edge change is required there.

### 3. Frontend — Azure Repos block in `CommsPulseCard.tsx` (lines ~879–902)

Restructure the block while keeping the existing 4 metric tiles. Add three new sub-sections, all guarded so old data still renders:

```text
┌─ Azure Repos ─────────────────────────────────────────────────┐
│ Repos: 12     Open / Blocked: 5 / 1                           │
│                                                               │
│ [Commits 7d] [Files +] [Files -] [Contributors]               │
│   42 ▲ +18%   120 ▲    34 ▼     6 (=)                         │  ← WoW chips
│                                                               │
│ Top contributor: Jane Doe — 14 commits · 312 changes ▲         │
│                                                               │
│ Contributors (last 7d)                                        │
│ ┌──────────────────────────┬────────┬────────┬──────────────┐ │
│ │ Author                   │ Commits│ Changes│ vs prev week │ │
│ ├──────────────────────────┼────────┼────────┼──────────────┤ │
│ │ Jane Doe                 │ 14     │ 312    │ ▲ +5         │ │
│ │ John Smith               │  9     │ 187    │ ▼ -2         │ │
│ │ ...                      │        │        │              │ │
│ └──────────────────────────┴────────┴────────┴──────────────┘ │
│                                                               │
│ Trend: activity is increasing (commits +18% WoW)              │
└───────────────────────────────────────────────────────────────┘
```

Details:
- Each metric tile gets a small WoW chip below the value (▲/▼/= + % vs prior 7d), color-themed via existing semantic tokens (`text-emerald-600 / text-rose-600 / text-muted-foreground`).
- "Top contributor" line uses the existing typography scale (small caps label + bold value).
- Contributor table: capped at top 8 by commits with a "Show all" toggle (collapsed by default to keep the card dense). Re-uses `Table` from `@/components/ui/table`.
- Trend sentence at the bottom is a one-line human summary derived from `wow.trend`.

### 4. Caching / performance

- The previous-week scan doubles the number of Azure REST calls. We will run both windows **in parallel per repo** (`Promise.all`) and reuse the existing repo-discovery loop, so latency increase should be ~1× rather than 2×.
- Keep the existing per-repo try/catch + `commit_scan_partial_failure` propagation so partial outages still render a useful card.

## Technical notes

- **Lines of code accuracy**: Azure DevOps `_apis/git/repositories/{id}/commits` only returns `changeCounts` (file-level Add/Edit/Delete). True line counts require an extra call to `/commits/{commitId}/changes` per commit. For the briefing card we will ship the file-change proxy (cheap, single round-trip per repo) and label the column **"Changes"** rather than "Lines" to avoid misleading the reader. If genuine line counts become a hard requirement later, we can add a `deep_diff: true` mode that fans out per-commit change calls behind a feature flag — out of scope for this iteration.
- All new numbers are computed server-side; the React component remains a pure renderer.
- No DB migration, no new secrets, no new edge function.

## Files touched

- `supabase/functions/azure-repos-api/index.ts` — extend `briefing_summary` case.
- `src/components/ceo/CommsPulseCard.tsx` — extend `azureReposSignal` type and the Azure Repos JSX block (no other props/components affected).

## Out of scope

- Changing the Operations page Work Items / PRs tabs.
- Per-repo drill-down (could be a follow-up).
- True line-of-code diffs (see trade-off above).
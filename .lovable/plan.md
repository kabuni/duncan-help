## Goal
Deliver a downloadable zip containing full CSV dumps of the 5 tables that feed the Home page "This week · your activity" tile and the Team leaderboard.

## Tables (and what they power)
1. `token_usage` — Tokens used, Hours saved (via request_count), and the entire leaderboard (`get_token_leaderboard` RPC reads only this table + profiles).
2. `workstream_tasks` — Tasks completed (workstream side).
3. `project_chat_plan_items` — Tasks completed (project side).
4. `meetings` — Meetings ingested.
5. `profiles` — display_name + avatar_url joined to leaderboard rows.

## Approach
Since these tables are not currently wired into the existing `export-all-tables` edge function's on-demand UI, I'll generate the CSVs directly from the database using `psql \COPY` in the sandbox and bundle them into a single zip written to `/mnt/documents/` so it's immediately downloadable via a `<presentation-artifact>` tag.

Steps:
1. Run `psql -c "COPY (SELECT * FROM public.<table>) TO STDOUT WITH CSV HEADER"` for each of the 5 tables, writing each to `/tmp/dashboard-activity-tables/<table>.csv`.
2. Zip the folder into `/mnt/documents/dashboard-activity-tables.zip` using `zip -j`.
3. Emit a `<presentation-artifact>` tag for the zip.

No code or schema changes. No new edge function. Pure read/export.

## Deliverable
`dashboard-activity-tables.zip` containing:
- `token_usage.csv`
- `workstream_tasks.csv`
- `project_chat_plan_items.csv`
- `meetings.csv`
- `profiles.csv`

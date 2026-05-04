## Goal

When a user lands on `/` (Duncan home), they should see a personalised, at-a-glance operating picture of Kabuni — not the two duplicate "Recruitment / Operations" buttons that already exist in the sidebar. The AI daily briefing and chat input stay, but move below the dashboard.

## What the new home looks like

```text
┌─────────────────────────────────────────────────────────────────┐
│ Header: Good morning, {name}.  Duncan is operational. 21°C ☁    │
│                                          [Feature] [What's New] │
├─────────────────────────────────────────────────────────────────┤
│  HERO — HOURS OF PLAY AROUND THE WORLD                          │
│   1,284,506 hrs   ▲ 4.2% WoW   • 28 countries today             │
│   sparkline (last 30 days)                                      │
├─────────────────────────────────────────────────────────────────┤
│  WEBSITE (kabuni.com · last 7d)        SOCIAL (last 7d)         │
│   Users  12.4k  ▲6%                     LinkedIn  +218 followers│
│   Sessions 18.1k                        Instagram +96 followers │
│   Top page  /play                       Posts this week  4      │
├─────────────────────────────────────────────────────────────────┤
│  HIRES              WORKSTREAMS              PROJECTS           │
│   3 open roles       12 active  • 2 🔴       7 active           │
│   18 candidates      4 overdue              42 files indexed    │
│   2 interviews wk    On-track 67%           3 updated today     │
├─────────────────────────────────────────────────────────────────┤
│  TODAY'S BRIEFING   (collapsible, the existing AI stream)       │
│  …                                                              │
├─────────────────────────────────────────────────────────────────┤
│  Chat input (existing)                                          │
└─────────────────────────────────────────────────────────────────┘
```

All numbers are real, fetched on mount with React Query, with skeleton loaders and graceful "—" fallbacks if a source isn't connected. RYG colours follow our Red/Yellow/Green convention.

## Data sources

| Tile | Source | How |
|---|---|---|
| Hours of Play (hero) | Google Analytics 4 (kabuni.com) | New action `play_hours` in `google-analytics-api` edge function — sum of a chosen GA event (`session_start` or a custom `play_time` event, whichever the property exposes) for last 30d + 7d delta + country count. |
| Website tile | Google Analytics 4 | New action `website_summary` — `activeUsers`, `sessions`, top page (last 7d). |
| Social tile | New LinkedIn + Instagram connectors | Separate follow-up — see "Phased delivery". v1 ships the tile with skeleton + "Connect LinkedIn / Instagram" CTA. |
| Hires tile | Existing tables `job_roles`, `candidates` | Direct Supabase query (RLS already in place). |
| Workstreams tile | `workstream_cards` | Count by status, count overdue (`due_date < now()` and not done), % on track (Green/total). |
| Projects tile | `projects`, `project_files` | Count of projects user can see, files indexed, count updated in last 24h. |

## Phased delivery

**Phase 1 — Personalised dashboard shell + real Kabuni data (this build)**
1. New `src/components/home/` directory with: `HoursOfPlayHero.tsx`, `WebsiteCard.tsx`, `SocialCard.tsx` (placeholder + connect CTA), `HiresCard.tsx`, `WorkstreamsCard.tsx`, `ProjectsCard.tsx`, `DashboardSkeleton.tsx`.
2. New hook `src/hooks/useHomeDashboard.ts` orchestrating React Query calls for each tile.
3. Extend `supabase/functions/google-analytics-api/index.ts` with two actions: `play_hours` and `website_summary`. Reuses existing token + refresh logic.
4. Refactor `src/pages/Index.tsx`:
   - Remove the duplicate "Recruitment / Operations" quick-nav row (lines 440–447).
   - When `!hasMessages`, render `<HomeDashboard />` instead of the two-card stub.
   - Move the daily briefing into a `<details>` "Today's briefing" card that auto-expands the first time per day, then collapses on subsequent visits.
   - Keep chat input pinned at the bottom; sending a message pushes the dashboard up and reveals the chat thread (as today).
5. Personalisation: greet by `profile.display_name`, surface "Your open workstreams: N" and "Your interviews this week: N" inside the relevant tiles when the user has them.

**Phase 2 — Social connectors (separate ticket once Phase 1 is approved)**
- Add LinkedIn connector + edge function `linkedin-api` (org page followers + post count).
- Add Instagram (Graph API via Meta) connector + edge function `instagram-api`.
- Replace `SocialCard` placeholder with live data; until connected, the tile shows a "Connect" CTA that routes to `/integrations`.

## Technical notes

- All edge function changes follow our standard inline CORS + `verify_jwt = false` + in-code `getUser()` pattern.
- New GA actions cache-keyed by `user_id + action` in React Query for 5 min; manual refresh button on each tile.
- Mobile-first: hero spans full width, then 1-col stack < `sm`, 2-col on `sm`, 3-col on `lg`. Reuses `StatusCard` style tokens.
- No new tables required for Phase 1.
- Briefing logic in `runBriefing()` is preserved verbatim — only its DOM placement changes.

## Out of scope

- Investor / external view (gated behind a separate role; can layer on later).
- Manual KPI overrides (no admin form for hardcoding numbers — everything is sourced).
- Replacing the chat surface.

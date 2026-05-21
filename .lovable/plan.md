
# Team Briefing — how it's populated & a clearer view of the company

## 1. How `/team-briefing` is populated right now

**Page:** `src/pages/CEOBriefing.tsx` (route `/team-briefing`)
**Hook:** `useCEOBriefing("morning")` — reads the latest 2 rows from `ceo_briefings` (today + yesterday for deltas).
**Generate button:** invokes edge function `ceo-briefing`, which writes a job to `ceo_briefing_jobs`, runs in the background (`EdgeRuntime.waitUntil`), and the page polls `ceo-briefing-status` every 3s until `completed`. On completion it re-reads `ceo_briefings`.

So the page itself is just a **render** of `ceo_briefings.payload` (the last LLM synthesis). It does not query live systems at view-time.

## 2. Where the briefing's data actually comes from

`supabase/functions/ceo-briefing/index.ts` runs ~25 queries in parallel, then calls 4 live sub-functions, then asks GPT to synthesise. Concretely:

**A. Pulled from Duncan's Supabase tables (snapshots already synced in by other jobs):**

| Source system | Table(s) read | Used for |
|---|---|---|
| Plaud / Google Meet | `meetings` (title, date, summary, action_items, participants, transcripts) | What changed, leadership signal, action items |
| Workstreams (in-app) | `workstream_cards`, `workstream_activity`, `workstream_card_assignees` | Scorecard, RAG, owners, accountability |
| Azure DevOps | `azure_work_items` | Execution signal, leadership delivery |
| Releases (in-app) | `releases` | What shipped |
| Recruitment | `candidates`, `job_roles` (via candidates) | Hiring signal |
| Purchase orders | `purchase_orders` | Spend signal |
| Bug / feedback | `issues` | Quality risk |
| Integrations health | `sync_logs`, `integration_audit_logs` | Data-coverage audit |
| Xero | `xero_invoices`, `xero_contacts` | Cash, overdue AR |
| Slack | `slack_notification_logs` | Comms/escalation echoes |
| AI usage | `token_usage` (last 30d) | Adoption / Lovable contributors |
| RAG / docs | `project_files`, `project_file_chunks` | Document intelligence, missing-artifact check |
| People | `profiles`, `user_roles` | Leadership roster, owners |
| Google Calendar | `google_calendar_tokens` + live `google-calendar-api` | Calendar coverage |
| Self-history | `ceo_briefings` (last N) | Trend deltas (probability, execution) |
| Chats | `general_chats`, `project_chats`, `gmail_writing_profiles` | Lovable contributors card |

**B. Fetched live per generation (sub-edge-functions):**

- `ceo-email-pulse` → Gmail (duncan@kabuni) inbox / thread signals
- `ceo-slack-pulse` → Slack channels & DMs
- `hubspot-api` → CRM pipeline signal
- `azure-repos-api` → commits / PR velocity

**C. Synthesised by:** GPT-4o (via `_shared/llm.ts` with fallback) producing the structured `payload` (verdict, pulse, tldr, workstream_scores, what_changed, risks, watchlist, leadership, decisions, coverage audit, etc.).

**Not currently fed in** (gaps): Google Analytics, social_stats_snapshots, Basecamp to-dos, Notion, Hireflix interview outcomes, Google Drive Weekly Reports folder.

## 3. Architecture today

```text
 Live APIs           Background syncs              Briefing run
 ─────────           ────────────────              ────────────
 Gmail   ─┐          Azure DevOps ─► azure_work_items ┐
 Slack   ─┤   ┌───►  Xero        ─► xero_*            │
 HubSpot ─┼──►│      Plaud/Meet  ─► meetings          ├─► ceo-briefing
 AzRepos ─┘   │      Hireflix    ─► candidates        │   (parallel reads
              │      App usage   ─► token_usage,      │    + 4 live fetches
 GCalendar ──►│                     workstream_cards, │    + LLM synth)
              │                     releases, POs…    │            │
              └────────────────────────────────────────┘            ▼
                                                          ceo_briefings.payload
                                                                    │
                                                                    ▼
                                                    /team-briefing (read-only render)
```

## 4. What "clear visualisation of the company" should look like

The current page renders ~12 dense sections in roughly source order. The reframe is to render **one company state, three lenses, evidence on demand** — matching what the data already produces.

**Above the fold — Company State (one screen):**

1. **Verdict Hero** — single RYG dot + one-sentence verdict + 3 KPI chips (Outcome Probability, Execution, Coverage) with day-over-day deltas. Merges today's `PulseBanner` + `TldrPanel`.
2. **Pulse Strip** — 5 horizontal cells, 2 numbers max each:
   - Delivery (workstreams red/amber, Azure items closed 24h)
   - Hiring (open roles, candidates moved)
   - Comms (Slack escalations, email backlog)
   - Cash (overdue AR £, this-week invoices)
   - Adoption (active Duncan users, top contributor)
3. **Do-Today** — top 3 ranked decisions from `payload.decisions` as hero cards ("what + why now"), promoted from the current numbered list.

**Below the fold — three collapsed zones, opened on click:**

- **Evidence** — Workstream Scorecard, What Changed, Risk Radar, full Decisions, Accountability Watchlist
- **Signals** — CommsPulseCard (Email/Slack/HubSpot/AzureRepos), CompanyPulseCard, Leadership grid
- **Adoption & Coverage** — DataCoverageCard, CoverageGaps, LovableContributorsCard

This keeps every existing component (no backend changes), but the CEO sees company state in ~10 seconds instead of scrolling through 12 equally-weighted blocks.

## 5. Components to build / change

**New (frontend only):**
- `src/components/ceo/VerdictHero.tsx` — merges PulseBanner + Tldr into one card; computes verdict sentence from `tldr.on_track / what_will_break / where_to_act`.
- `src/components/ceo/PulseStrip.tsx` — 5-cell strip; pulls numbers already present in `payload` (workstream_scores, hubspot_signal, slack_pulse, xero counts via Decisions context, token_usage leaderboard).
- `src/components/ceo/DoToday.tsx` — promotes `payload.decisions.slice(0,3)`.

**Reused as-is, wrapped in 3 `<Collapsible>` zones:** WorkstreamScorecard table, RiskRadar, CommsPulseCard, CompanyPulseCard, DataCoverageCard, CoverageGaps, LovableContributorsCard, AccountabilityWatchlist, full Decisions list, LeadershipGrid.

**Delete:** `PulseBanner.tsx`, `TldrPanel.tsx` (logic absorbed by VerdictHero). Keep `ScoreGauge` for KPI chips.

**No changes to:** `ceo-briefing` edge function, payload shape, RLS, scheduling.

## 6. Optional next step (not in this plan)

Add Google Analytics, social_stats_snapshots, Hireflix interview outcomes, and the Weekly Reports Drive folder summariser into `ceo-briefing` so the Pulse Strip's "Adoption" and "Hiring" cells reflect real traffic + interview signal, not just app usage.

## 7. Effort

~3h frontend only: 1.5h three new components, 30m collapsibles + zone wiring, 15m delete old, 45m responsive QA on `/team-briefing`.

**Open question:** ship the 3 below-the-fold zones **collapsed by default** (CEO sees state in one screen, opens evidence on demand) or **expanded** (preserves today's behaviour, just reordered)?

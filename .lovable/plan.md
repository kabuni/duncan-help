
# Duncan Key Events Diary

A strategic execution diary for Kabuni. Duncan reads exclusively from a single Google Calendar named **"Duncan | Key Events"**, classifies each event, flags gaps and risks, links events to company goals, and surfaces the most important ones in dashboards and the daily briefing.

## 1. Calendar source: dedicated connection

A new Google OAuth connection just for Duncan's own Google account. No employee calendars are ever read.

- New table `duncan_calendar_tokens` (single row, admin-managed):
  `id, access_token, refresh_token, token_expiry, calendar_id, calendar_name, connected_by, created_at, updated_at`.
- New edge functions, mirroring the existing `google-calendar-*` pattern but isolated:
  - `duncan-calendar-auth` — admin-only OAuth start (scopes: `calendar.readonly`, `calendar.events.readonly`).
  - `duncan-calendar-callback` — stores the single shared token row; auto-resolves the calendar named "Duncan | Key Events" and stores its `calendar_id`.
  - `duncan-calendar-sync` — pulls events from that one calendar only, upserts into `key_events`, classifies and flags. Refreshes access token as needed.
- RLS: only admins can manage the token row; all authenticated users can read connection status (no tokens).

## 2. Data model

### `key_events` (synced from Google)
```
id uuid pk
google_event_id text unique
calendar_id text
title text
raw_description text
start_at timestamptz, end_at timestamptz, all_day bool
location text, html_link text
organizer_email text, attendees jsonb
status text  -- google status: confirmed/tentative/cancelled

-- Parsed from title/description
category text          -- e.g. Launch, Investor, Board, Partnership, Campaign, Product, Fundraising, Other
event_name text        -- title minus [Category]
owner text
objective text
success_metric text
decision_needed text
linked_docs jsonb      -- array of urls
risks text
next_action text

-- Derived
missing_fields text[]  -- which mandatory fields are absent
is_complete bool
risk_level text        -- green | amber | red
linked_goal_ids uuid[]
classification_confidence numeric
last_classified_at timestamptz

created_at, updated_at timestamptz
synced_at timestamptz
deleted_in_google bool default false
```

### `key_event_goals` (editable goals)
```
id uuid pk
name text             -- "June 7 launch", "1M K10 registrations", etc.
description text
target_date date
status text            -- active | achieved | dropped
sort_order int
created_at, updated_at
```
Seeded with the five goals you listed. Admin UI to edit later.

### `key_event_sync_log`
`id, started_at, finished_at, events_seen, events_upserted, events_flagged, error`.

RLS: all authenticated users read; only admins write. Sync runs as service role.

## 3. Sync + classification

`duncan-calendar-sync` runs:
1. Refresh OAuth token if needed.
2. Fetch events from "Duncan | Key Events" for window: now − 30 days → now + 365 days, with `singleEvents=true`.
3. For each event:
   - Parse `[Category] Event name` from title (regex). Unknown → category=`Uncategorised`.
   - Parse description into the 7 mandatory fields. Description format expected as `Owner:`, `Objective:`, `Success metric:`, `Decision needed:`, `Linked docs:`, `Risks:`, `Next action:` (case-insensitive, multi-line tolerant).
   - Compute `missing_fields`, `is_complete`.
   - `risk_level`:
     - red: missing owner OR missing next_action OR (start_at within 14 days AND not complete) OR explicit risk text contains "blocker/critical/at risk"
     - amber: any other missing field OR start within 30 days and incomplete
     - green: complete and >30 days out OR explicitly on track
   - Goal linking: lightweight keyword + AI fallback. First pass — match goal name keywords against title/description. If ambiguous, send to OpenAI `gpt-4o-mini` with the active goals list and event payload, return `linked_goal_ids` + `classification_confidence`.
4. Mark events present in DB but missing from Google as `deleted_in_google=true`.
5. Write a row to `key_event_sync_log`.

Triggers:
- Cron every 15 minutes via `pg_cron` calling `duncan-calendar-sync`.
- Manual "Sync now" button on the dashboard (admin only).

## 4. Dashboard: `/diary` (Duncan Key Events Diary)

New page added to the sidebar (after Operations). Sections:

- **Header**: connection status, last sync time, "Sync now" (admin), link to the calendar in Google.
- **Filters**: category, goal, owner, risk level, date range.
- **Cards / sections**:
  - Today
  - This week
  - Upcoming (next 30 days)
  - Launch milestones (category = Launch, sorted by date)
  - India launch timeline (linked to "India product launch" goal)
  - Investor events (category = Investor or Board)
  - Events at risk (risk_level = red or amber)
  - Events missing owners or actions (filter on `missing_fields`)
- **Event row** shows: date/time, `[Category] Event name`, owner, goal pill(s), risk pill, missing-fields chip list, link to Google Calendar event, and an inline "Why flagged?" tooltip.
- **Empty states** for each section.
- **Goals admin tab** (admin only): add/edit/delete goals in `key_event_goals`.

UI uses existing tokens (`index.css` HSL vars), shadcn cards/tables, RYG color coding consistent with workstreams.

## 5. Daily briefing integration

Extend `daily-briefing` edge function to include a "Key Events" block, structured as:

- Today (key events only)
- This week (next 7 days)
- Launch-critical (any event linked to "June 7 launch", "Product delivery", or "India product launch" within next 30 days)
- Risks (red events in next 60 days, with reason)
- Decisions needed from Nimesh (events where `decision_needed` is non-empty AND start_at within next 21 days)
- Follow-ups (events that ended in last 7 days with `next_action` present and not marked done — for v1 we surface `next_action` text as the follow-up)

This block runs before the existing Workstreams block in the briefing (Calendar > Meetings > Workstreams already established; key events sit at the top of Calendar).

## 6. Chat / Duncan tools

Add three tools to the prompt engine so Duncan can reason about key events in chat:

- `list_key_events(filter)` — by date range, goal, category, risk, owner, missing_fields.
- `get_key_event(id)` — full record incl. parsed fields, goal links, risk reasoning.
- `summarise_key_events(scope)` — `today | week | launch | risks | decisions | followups`.

These read directly from `key_events`/`key_event_goals` (no Google round-trip). Deliberately read-only — Duncan does not create or edit calendar events; the team writes them in Google.

## 7. Rules baked in

- Hard scope: only the calendar id resolved as "Duncan | Key Events". Sync function rejects any other calendar id.
- No employee calendar reads anywhere in the codebase for this feature (separate from existing per-user `google_calendar_tokens` used by Diary Intelligence; we leave that untouched).
- Duncan calendar is not for meetings — surfaced in the dashboard header copy and in the briefing intro.

## 8. Technical details

- Edge functions: `duncan-calendar-auth`, `duncan-calendar-callback`, `duncan-calendar-sync`. All `verify_jwt = false` with internal `getUser()` + `has_role('admin')` checks for admin actions; sync callable by service role and via cron.
- Migrations: create `duncan_calendar_tokens`, `key_events`, `key_event_goals`, `key_event_sync_log` with RLS as above; seed 5 goals; enable `pg_cron` + `pg_net`; schedule sync every 15 minutes.
- Reuse `OPENAI_API_KEY` (already set) for the goal-linking fallback. Reuse `GOOGLE_CALENDAR_CLIENT_ID/SECRET` for OAuth (no new secrets).
- Frontend: new `/diary` route, `useKeyEvents`, `useKeyEventGoals` hooks; sidebar entry; admin-only goals editor.
- Memory: add `mem://features/key-events-diary` describing the system; update index.

## 9. Out of scope (v1)

- Editing/creating events from inside Duncan (calendar stays the source of truth).
- Per-event Slack notifications (can layer on later via existing Slack gateway).
- Historical analytics beyond 30 days back.

## 10. Setup steps for you after merge

1. From an admin account, go to Settings → Integrations → "Duncan Key Events Calendar" → Connect, and sign in with Duncan's Google account.
2. Confirm the dashboard shows "Connected" and the calendar id maps to "Duncan | Key Events".
3. Hit "Sync now" once; verify events appear in `/diary`.

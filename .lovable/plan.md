## Goal

Redesign `/diary` from a list-of-sections dashboard into a true **Google-Calendar-style** view (Month / Week / Day) that displays events from "Duncan | Key Events" plus a sidebar of company **Goals**. Also fix the newly-added goal not surfacing on the dashboard.

## Why your goal "didn't go through"

It actually saved correctly — the row `Simon tesr` (target 2026-05-13) is in the database. The dashboard only renders **events**, never **goals**, so a new goal silently disappears unless you switch to the Goals tab (admin only). The redesign fixes this by giving goals first-class real estate.

## What we'll build

### 1. Calendar grid as the primary view

Use **react-big-calendar** (mature, lightweight, Google-style) with `date-fns` localizer.

```text
┌──────────────────────────────────────────────┬──────────────┐
│  Duncan Key Events Diary    [Today][<][>]    │   GOALS      │
│  May 2026             [Month][Week][Day]     │  ─────────   │
├──────────────────────────────────────────────┤ June 7 launch│
│ Sun  Mon  Tue  Wed  Thu  Fri  Sat            │ 1M K10 regs  │
│  …    …   ●Launch prep    …                  │ 100k preord  │
│                                              │ Fundraising  │
│                                              │ Product del. │
│                                              │ + add goal   │
└──────────────────────────────────────────────┴──────────────┘
        Connection bar + Sync now (admin)
```

- Month / Week / Day toggle (Agenda view also free).
- Today, prev, next navigation.
- Events colored by `risk_level` (green / amber / red).
- Goal `target_date` markers shown as full-day pinned events with a distinct style (e.g. dashed border + `Target` icon) so goal deadlines appear directly on the calendar — this is what makes the new goal visible.
- Click an event → opens a side drawer with the existing event detail (objective, owner, missing fields, risks, html_link).
- Click a goal marker → drawer with goal detail and linked events.

### 2. Goals panel (always visible)

Right-hand sidebar (collapses to a tab on mobile):
- Lists every goal with name, target date, status, and a tiny count of linked events.
- Inline "Add goal" form available to **all authenticated users** (not just admins) — see permissions note below — with name, description, optional date.
- Edit / delete remain admin-only.

### 3. Events at risk strip

Above the calendar: a single compact strip showing the count of red / amber events and "missing owner" — clickable to filter the calendar to only those.

### 4. Remove the old categorized dashboard

The old "Today / This week / Launch milestones / India / Investor / Missing / Upcoming" cards go away. Replaced by:
- Calendar (default view, primary)
- "All events" tab kept as a searchable list (useful for triage)
- "Goals" tab kept for bulk admin management

### 5. Permissions tweak (small)

Currently `key_event_goals` insert is admin-only. We'll leave that policy in place but the in-app "Add goal" affordance is also admin-only (matching DB rules) so non-admins don't get a silent failure. (Your account is admin so this works for you.)

## Technical notes

**New dependencies**
- `react-big-calendar`
- `date-fns` (likely already present via shadcn — will reuse if so)

**New / changed files**
- `src/pages/KeyEventsDiary.tsx` — full rewrite around `<Calendar/>`
- `src/components/diary/EventDrawer.tsx` — click-to-open event detail
- `src/components/diary/GoalsPanel.tsx` — right sidebar with inline add
- `src/components/diary/calendar.css` — minimal overrides to match theme tokens (`--background`, `--border`, `--primary`, risk colors)

**Data shape**
- Events come from existing `useKeyEvents` hook unchanged.
- Goals with a `target_date` are converted into synthetic full-day calendar items: `{ id: goal:<id>, title: "🎯 " + name, allDay: true, kind: "goal" }`.
- Filtering works in-memory; no schema changes.

**No DB migrations.** Schema and sync function are unchanged.

**What stays the same**
- Sync, OAuth flow, `key_events` / `key_event_goals` / `key_event_sync_log` tables.
- Connection card and "Sync now" admin action.
- All-events list and Goals admin tab (kept as secondary tabs).

## Out of scope (ask if you want them)

- Creating events directly from the calendar (would need a Google Calendar write flow back to Duncan's account).
- Holidays overlay (would need a public-holidays calendar import — can add as a follow-up).
- Drag-to-reschedule.

Approve and I'll implement.
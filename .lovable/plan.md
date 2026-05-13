## Goal

RSVP confirmation/missing-detail emails for the **Kabuni Showcase Mumbai** event (7 June, Jio Centre, Mumbai) should display the full schedule in **India Standard Time** only — no UK time — and use the correct event name as it appears in the planner.

## Changes (all in `supabase/functions/process-rsvp-emails/index.ts`)

### 1. Time formatting
- Replace the current `Europe/London` formatter with `Asia/Kolkata`.
- Output format: `Sat, 7 Jun 2026 · 12:00 IST` (no "London time" suffix, no UK conversion anywhere).

### 2. Event-specific schedule block
For events whose title matches **"Kabuni Showcase Mumbai"** (case-insensitive), inject a fixed agenda into the email instead of a single start time:

```
12:00 – 13:00 IST   Lunch
13:00 – 15:00 IST   Kabuni Launch (main event)
15:00 – 16:00 IST   High tea
```

Rendered as a styled mini-table in the HTML email, and as plain bullet lines in the text fallback.

The "When" highlight row becomes: `Saturday, 7 June · 12:00 – 16:00 IST`
The "Where" highlight row uses the planner's location, falling back to `Jio Centre, Mumbai` for this event.

For all other events, keep the current single-line "When" behaviour but in IST (or whatever timezone the planner stores — for now we standardise on IST since the only live event is Mumbai).

### 3. Event name
No code change needed for the title itself — the email already uses `ev.title` from the planner record. Action item for the user (outside this plan): rename the planner entry to **"Kabuni Showcase Mumbai"** if it isn't already, so the email subject/heading reflect it. The matcher already accepts the new name.

### 4. Greeting copy
Confirmed-state greeting becomes:
> "You're confirmed for **Kabuni Showcase Mumbai**, {firstName} 🎉"

Intro line:
> "We've got you down for **Kabuni Showcase Mumbai** at Jio Centre, Mumbai on Saturday 7 June. Here's the running order for the day."

### 5. Plain-text fallback
Mirror the same IST schedule as a clean bulleted list so non-HTML clients see the same info.

## Out of scope
- No DB migration — purely email rendering.
- No change to matcher logic, suppression, or cron schedule.
- No UI changes in the EventRsvps panel (it doesn't show event time).

## Deploy
After edits: deploy `process-rsvp-emails` and trigger one manual run to verify formatting against a real RSVP thread.

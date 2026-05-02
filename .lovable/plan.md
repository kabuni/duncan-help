# Sync diary events to personal Google Calendar

## Background

The `/diary` page writes to a **shared company calendar** (Duncan | Key Events) connected once by an admin. It is not per-user. Users separately connect their own Google Calendar in Settings → Integrations for personal calendar features (briefing, availability checks, chat scheduling).

These two stay decoupled today. We'll add an opt-in bridge so a user can copy a diary entry into their own personal calendar at the moment of creation.

## What changes for the user

In **Add diary entry** dialog:

- New checkbox: **"Also add to my personal Google Calendar"**
  - Hidden if the user has not connected their personal Google Calendar
  - Shown but disabled with a helper line ("Connect your Google Calendar in Settings to enable") if not connected
  - Off by default
- When checked, after the diary event is saved, an event is also created in the user's personal Google Calendar with the same title, dates, time, location, and notes.
- A toast confirms: "Event added to diary and your personal calendar".

No change to viewing, approvals, attachments, or the shared diary itself.

## Technical implementation

### 1. New edge function: `add-event-to-personal-calendar`

- `verify_jwt = false`, validates JWT in code via `supabase.auth.getUser()` (project standard).
- Input: `{ event_name, category, start_at, end_at, all_day, location, notes }`.
- Loads the caller's row from `google_calendar_tokens`; if missing → 400 "personal calendar not connected".
- Refreshes the access token using `GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET` (same OAuth app used for personal Gmail/Calendar — see `useGoogleCalendar` / `google-calendar-api` for the existing refresh pattern).
- POSTs to `https://www.googleapis.com/calendar/v3/calendars/primary/events` with:
  - `summary`: `[Category] Event name`
  - `description`: notes (optional)
  - `location` (optional)
  - `start` / `end`: either `{ date }` (all-day) or `{ dateTime, timeZone: 'UTC' }`
- Returns `{ id, htmlLink }`.

### 2. Frontend changes — `src/components/diary/AddEventDialog.tsx`

- New state `syncToPersonal: boolean` and `personalCalendarConnected: boolean`.
- On dialog open, in addition to loading owners, query `google_calendar_tokens` filtered to the current user (RLS already restricts to `auth.uid() = user_id`) to determine if connected.
- Render the checkbox under the date/time block. Disabled + helper text when not connected.
- After the existing `key_events` insert + attachments + approvals block, if `syncToPersonal` is true call `supabase.functions.invoke('add-event-to-personal-calendar', { body: {...} })`. On error show a non-blocking toast ("Saved to diary, but personal calendar sync failed: …") — the diary event still succeeds.

### 3. No schema changes

We do not store a link between the diary event and the personal calendar event. Sync is a one-time push at creation time. Future edits in `/diary` will not propagate (called out below as a known limit).

## Out of scope (call out, don't build)

- Two-way sync, edits, or deletes propagating from diary → personal calendar.
- Bulk "sync all existing events to my calendar" action.
- Per-user mirror of the entire shared diary into their primary calendar (would clutter personal calendars and is rarely wanted).

## Files touched

- **New**: `supabase/functions/add-event-to-personal-calendar/index.ts`
- **Edited**: `src/components/diary/AddEventDialog.tsx`

## Problem

When Duncan books a meeting via `create_calendar_event` (norman-chat), the event is created on the prompter's primary Google Calendar so they are the implicit organiser — but they are NOT added to the explicit `attendees` list. Google therefore shows "1 guest" (only the named attendee, e.g. Palash) with no row for the organiser, and tools that count attendees / send RSVP emails treat the prompter as absent. The user wants themselves to appear as an attendee on every meeting Duncan books for them.

## Fix

In `supabase/functions/norman-chat/index.ts`, inside the `create_calendar_event` tool handler (around lines 5181–5224):

1. After resolving `resolvedAttendees` from the user-supplied names/emails, also push the caller's own email (`identity?.email`) into the attendee list, marked as `organizer: true` and `responseStatus: "accepted"` so Google shows them as the confirmed organiser-guest.
2. De-duplicate by lowercased email so we never add the prompter twice if the model already included them.
3. Only add the self-attendee when `identity?.email` exists (skip silently if unknown — falls back to current behaviour).
4. Keep the existing `resolvedAttendees.length > 0 ? … : undefined` guard semantics: if no other attendees AND no identity email, still send `undefined` (solo blocker event stays attendee-less).

No prompt/system-message changes needed — the model keeps passing only the *other* attendees; the server silently ensures the prompter is on the invite.

## Test

After the edit:
1. Deploy `norman-chat` via `supabase--deploy_edge_functions`.
2. In the live preview (logged in as adit@kabuni.com), send a chat like: *"Book a 15 min test meeting with Palash today at 12:30, call it Duncan Self-Attendee Test"* and confirm the pending-write card.
3. Pull `supabase--edge_function_logs` for `norman-chat` to verify the outbound Google payload includes both `palash@…` and `adit@kabuni.com` in `attendees`.
4. Query `key_events` / re-list via `list_calendar_events` for that day and confirm both attendees are returned by Google.
5. Visually verify in the screenshot-style Google Calendar popup that the event now shows 2 guests (Adit + Palash) instead of 1.

If verification fails (e.g. Google strips the organiser entry), fall back to including `self: true` on the organiser attendee object, which Google preserves.

## Scope

- Edit: `supabase/functions/norman-chat/index.ts` only (single block inside `create_calendar_event`).
- No DB migrations, no client changes, no prompt changes.
- `update_calendar_event` / `reschedule_event` are out of scope — they don't rebuild the attendee list.
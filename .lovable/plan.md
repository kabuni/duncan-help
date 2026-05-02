## Goal

Make Planner approvals push-driven instead of pull-driven:
1. Slack DM to the approver when a request is raised, decided, or a counter-date is proposed
2. In-app **Notifications** center in Duncan (bell icon, unread count, list)
3. **Suggest new date** flow so approvers can counter-propose instead of only Approve/Reject

---

## 1. Slack DMs to the approver

Yes — DMs (not channel messages), using the existing Slack bot via `slack-send-message` and `user_notification_mappings.slack_user_identifier` (same pattern as Workstreams overdue + Basecamp). If the approver has no mapping, skip Slack silently and still create the in-app notification.

**Triggers (3 messages):**
- **Request raised** → DM the approver: event title, date, type, label, requester, "Open in Planner" link to `/planner?event={id}`.
- **Decision made** (approved / rejected / counter-proposed) → DM the requester with outcome + note + new date if any.
- **Counter-date accepted/declined** by requester → DM the approver to close the loop.

Implementation: new edge function `notify-event-approval` (POST `{ approval_id, kind }`). Called from `EventApprovals.tsx` after each insert/update. Uses service role to look up event, profiles, and slack identifier. Failures are logged but never block the UI action.

---

## 2. In-app Notifications center

A bell icon in the top-right of `AppLayout` with an unread badge. Clicking opens a popover list (latest 20) with: title, body, time-ago, link, mark-read / mark-all-read.

**New table `notifications`:**
```
id uuid pk, user_id uuid (profiles.user_id), kind text,
title text, body text, link text,
metadata jsonb, read_at timestamptz, created_at timestamptz default now()
```
RLS: user can `SELECT`/`UPDATE` (mark read) only their own rows; service role inserts. Realtime enabled so the bell updates live.

The same `notify-event-approval` function inserts a `notifications` row alongside the Slack DM, so users without a Slack mapping still get notified in Duncan.

**Reused for future events:** Workstreams assignments, overdue tasks, meeting digests can all write to this same table later.

---

## 3. Suggest new date (counter-propose)

**Schema additions to `key_event_approvals`:**
- `proposed_date date` — approver's suggested new date
- `proposed_note text` — reason for the suggestion
- Extend `event_approval_status` enum with `proposed`

**UI changes in `EventApprovals.tsx`:**
- Approver row gets a 3rd action: **Suggest new date** → small inline popover with date picker + optional note.
- When status = `proposed`, the row shows the suggested date and the requester sees two buttons: **Accept new date** (updates `key_events.start_date` and sets approval to `approved`) or **Decline** (sets back to `pending` so approver can re-decide).
- Decision note field becomes visible on Approve / Reject too (optional one-liner).

---

## Files to add / change

**New**
- `supabase/migrations/<ts>_notifications_and_proposed_dates.sql` — `notifications` table + RLS + realtime; add `proposed_date`, `proposed_note` columns; add `proposed` to enum.
- `supabase/functions/notify-event-approval/index.ts` — Slack DM + insert into `notifications`.
- `src/components/notifications/NotificationsBell.tsx` — bell + popover list, realtime subscription.
- `src/hooks/useNotifications.ts` — fetch / mark-read / unread count.

**Edit**
- `src/components/diary/EventApprovals.tsx` — add Suggest-date UI, Accept/Decline counter, decision note input, call `notify-event-approval` after each state change.
- `src/components/AppLayout.tsx` (or the top bar) — mount `<NotificationsBell />`.

---

## Out of scope (flag for later)

- Email notifications (Slack + in-app cover the immediate need; email can be layered on once the `notifications` table exists).
- Surfacing pending-approval count in the Duncan daily briefing — easy follow-up using the same table.

---

## Technical notes

- Edge function uses `verify_jwt = false` + validates the caller via `supabase.auth.getUser()` (project standard).
- Slack send goes through existing `slack-send-message` helper — no new Slack scopes needed; bot DM works with current `chat:write` + `im:write`.
- The `notifications` table is generic on purpose so we don't have to rebuild this for every future feature.

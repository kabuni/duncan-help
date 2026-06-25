## Revised after feedback

- `risk_level` is NOT purely cosmetic — `duncan-calendar-sync` derives it from missing fields/blockers and `DetailDrawer` shows it as a risk badge. Reusing it would conflict with sync. → Introduce a dedicated `approval_state` column instead.
- Triggers will only **synchronise state**. Deletion on rejection moves into the edge function, after emails are sent.

## Current Architecture (unchanged from prior plan)

- **Events**: `public.key_events`, colour driven by `risk_level` (`evt-green/amber/red` in `calendar.css`).
- **Approvals**: `public.key_event_approvals` (status `pending`/`approved`/`rejected`/`proposed`), mirrored into the unified `approvals` inbox by trigger `sync_event_approval_to_inbox`.
- **Decision flow**: `EventApprovals.tsx` → update `key_event_approvals.status` → client calls `notify-event-approval` → Slack DM + `notifications` row. No email today.
- **Email precedent**: `send-po-approval-email` sends via the shared `duncan@kabuni.com` Gmail sender (`getGmailSenderToken`).

## Proposed Changes

### 1. Database (one migration)

Add a dedicated presentation/state column — no overloading of `risk_level`:

```sql
ALTER TABLE public.key_events
  ADD COLUMN approval_state text;  -- null | 'pending' | 'approved'
CREATE INDEX idx_key_events_approval_state ON public.key_events(approval_state);
```

Trigger `sync_event_approval_state` on `key_event_approvals` (AFTER INSERT/UPDATE/DELETE) — **state sync only, no deletes, no row removal**:

- Recomputes `key_events.approval_state` for the affected `event_id`:
  - `pending` if any approval row is `pending` or `proposed`
  - `approved` if at least one is `approved` and none are pending/proposed
  - `null` if no approval rows exist (or all `rejected` and event still around)
- Never touches `risk_level` or `risk_reason`.
- Never deletes anything.

### 2. Edge Function — `notify-event-approval`

Extend the existing `decided` branch:

1. Insert the existing notification + Slack DM (unchanged).
2. **New:** look up the requester's auth email and send a transactional email via the Gmail sender (copy `getGmailSenderToken` + send helper from `send-po-approval-email`):
   - Approved → `Subject: Approved: <event title>` with date, approver name, decision note, link to `/diary`.
   - Rejected → `Subject: Declined: <event title>` with approver name, reason, link to `/diary`.
3. **New (rejection only, after email send succeeds or fails non-fatally):** delete the `key_events` row for this `event_id` using the service-role client. All deletion logic lives here, not in a trigger. Future business logic (audit, restore window, etc.) can hook in at this point.

Order: notifications → email → deletion. Wrapped so a failed email doesn't block deletion, but a failed deletion is logged and surfaced.

### 3. UI

- **`KeyEventsDiary.tsx` `eventPropGetter`**: prefer `approval_state` when present.
  ```ts
  const colorKey = ev.approval_state === "pending" ? "amber"
                 : ev.approval_state === "approved" ? "green"
                 : ev.risk_level;
  return { className: `evt-${colorKey}`, style: { ["--cat-color"]: meta.hsl } };
  ```
  No CSS changes — existing `evt-amber` / `evt-green` classes are reused.
- **`EventApprovals.tsx`**: after a `rejected` decision, refresh parent so the now-deleted event drops from the diary; toast reads "Request declined — event removed".
- **`DetailDrawer.tsx`**: small pill near the title when `approval_state='pending'` so users understand the amber state ("Pending approval"). Risk badge keeps its current meaning.
- **`useKeyEvents.ts`** + types regenerate after migration to expose `approval_state`.

### 4. Email

One Gmail helper added inside `notify-event-approval`. No new edge function, no Resend, no new secrets.

## Constraints honoured

- Reuses `key_event_approvals`, `approvals` inbox, and the existing Gmail sender.
- New column is minimal and explicitly named for its purpose — no overloading of `risk_level`.
- Triggers are sync-only. All side effects (email, deletion) live in the edge function where business logic belongs.
- No duplicated approval logic, no extra tables.
- Planner colour is driven by event state (`approval_state` then `risk_level`), not hardcoded UI branching.

Approve to implement.
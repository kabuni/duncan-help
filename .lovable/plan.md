No code changes are needed. This is a documentation/explanation request answered in chat above.

The response covers, with exact file paths and line references:

1. **Add Event flow** — `AddEventDialog.tsx` inserts into `public.key_events` (full field list). Initial `approval_state` is `"approved"` for `PublicHoliday`, otherwise `NULL`.
2. **Leave/Holiday approval flow** — end-to-end: insert into `public.key_event_approvals`, `notify-event-approval` edge function, DB triggers `sync_event_approval_state` and `sync_event_approval_to_inbox`, counter-proposal branch, and event deletion on rejection.
3. **Approval states** — `key_events.approval_state` (`pending|approved|rejected|NULL`) vs `key_event_approvals.status` (`pending|approved|rejected|proposed`), stored in separate tables and reconciled by trigger.
4. **Colour coding** — priority chain in `KeyEventsDiary.tsx` eventPropGetter (holiday → pending=amber → approved=green → fallback risk_level), with the exact HSL values from `calendar.css`.
5. **Who can approve** — restricted to `approver_profile_id`, enforced both in the UI and server-side in the `notify-event-approval` edge function.
6. **Frontend components** — `EventApprovals.tsx`, `DetailDrawer.tsx`, `AddEventDialog.tsx`, `KeyEventsDiary.tsx`, `calendar.css`.
7. **Notifications** — in-app `notifications` row, Slack DM via Lovable connector, Gmail email from `duncan@kabuni.com`; approvals also mirrored into the unified `approvals` inbox.

Confirm and I'll do nothing further, or tell me which section you'd like expanded (e.g. RLS policy SQL, trigger source, or a diagram).
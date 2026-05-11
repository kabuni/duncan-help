## Travel Approval Process

A new Travel Request type that captures full trip details, requires a fixed approver (CEO/Ops), and shows up in the existing Approvals inbox alongside Purchase Orders and Key Events.

### 1. Database (`travel_requests` table)

Fields:
- Traveller (`traveller_user_id`, plus `traveller_name` snapshot)
- Trip purpose, destination (city + country)
- Depart date, return date
- Transport mode (flight / train / car / other), accommodation needed (bool)
- Estimated cost + currency (default GBP)
- Notes, attachment_path (quotes/itinerary)
- Status (`pending_approval` / `approved` / `rejected` / `cancelled`)
- Fixed approver fields (`approver_user_id`, `approved_by`, `approved_at`, `rejection_reason`)
- Standard `requester_id`, `created_at`, `updated_at`, request reference number (auto-generated `TR-####`)

RLS:
- Requesters can view/create their own requests
- Approver and admins can view all and update status
- Admins can manage everything

Trigger:
- On insert/update, mirror into `approvals` table with `kind='other'` (or new `kind='travel'` enum value), `source_table='travel_requests'`, `link_path='/travel'`, populating title (`"Travel: <destination> (<dates>)"`), summary, amount/currency, approver_user_id.
- Reuse the same status-sync pattern as POs so decisions in either place stay aligned.

Approver routing:
- Add a `travel_approver_user_id` setting in a small config table (or reuse `ceo_action_routing` / a single-row settings table). Admin picks the fixed approver in Settings; the trigger reads it.

### 2. Approval kind

Extend `ApprovalKind` (TS) and the `approval_kind` enum (Postgres) with `travel`. Update `KIND_LABEL` in `Approvals.tsx` to include "Travel". `bucketOf` routes travel into the **Other** column (or a new column — see open question).

### 3. Frontend

**New page `/travel`** (added to sidebar under Approvals area):
- Tabs mirroring PurchaseOrders: My Requests / Approvals / (Admin)
- "New Travel Request" button opens `TravelForm` dialog
- `TravelList` shows the user's requests with status badges
- `TravelApprovals` shows requests awaiting the current user (approver view)
- Admin tab: pick the fixed approver

**Decision wiring** in `useApprovals.ts`:
- Extend `useDecideApproval` with a branch for `source_table === 'travel_requests'` that updates the source row (status, approved_by/at, rejection_reason) and the inbox row, mirroring the PO branch.

**Cancel** mirrors `useCancelPO`: deletes inbox rows then the travel row.

### 4. Notifications

Reuse the existing approval notification pattern (Slack DM via `notify-event-approval` or a small `send-travel-approval-email` edge function modeled on `send-po-approval-email`). Fire-and-forget on submit and on decision.

### Files to add

```text
src/pages/Travel.tsx
src/hooks/useTravelRequests.ts
src/components/travel/TravelForm.tsx
src/components/travel/TravelList.tsx
src/components/travel/TravelApprovals.tsx
src/components/travel/TravelApproverSetting.tsx   (admin)
supabase/functions/send-travel-approval-email/index.ts   (optional, mirrors PO)
```

### Files to update

- `src/App.tsx` — register `/travel` route
- `src/components/Sidebar.tsx` — add Travel nav entry
- `src/pages/Approvals.tsx` — add `travel` to `KIND_LABEL`, optional bucket
- `src/hooks/useApprovals.ts` — `ApprovalKind` union + decide branch
- Migration: new table + enum value + RLS + trigger + settings row

### Open questions (small)

1. Should Travel get its own column in the Approvals inbox board, or stay in **Other**?
2. Should there be an auto-approve threshold (e.g. trips under £200) like POs, or always require approval? Current assumption: **always require approval**.

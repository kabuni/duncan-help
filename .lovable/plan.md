
# Improving the approval process

## The problem

Today, "approvals" live in three disconnected places:

1. **Planner** (`key_event_approvals`) — bolted onto calendar events. Works for "approve this launch date", awkward for anything without a date (a cost, a contract, a hire).
2. **Purchase Orders** (`POApprovals`) — proper tiered sign-off (dept owner / admin), rejection reasons, but isolated on its own page.
3. **Account approvals**, **Release approvals**, etc. — each in its own settings nook.

Nothing pulls these into one place for the approver, and there's no obvious home for "I need someone to sign off £4k of spend that isn't tied to an event."

## Recommendation — three layers

### 1. Stop forcing costs into the planner

Costs should flow through **Purchase Orders**, not planner approvals. The PO module already supports vendor, amount, department, tiered approval, rejection reasons and audit. We extend it slightly so it covers *all* cost sign-off cases, not just formal POs:

- Add a lightweight **"Cost approval"** entry type alongside formal POs (same table, `kind = 'cost' | 'po'`). One-line description, amount, department, attachments — no need for a vendor/PO number for ad-hoc spend.
- From the planner event detail, an event with budget impact gets a **"Request cost sign-off"** button that pre-fills a cost approval and links back to the event (`linked_event_id`) — instead of pretending the approval *is* the event.

### 2. Introduce a generic `approvals` primitive

A single table that any module can write to:

```text
approvals
  id, kind ('cost' | 'event_date' | 'release' | 'hire' | 'contract' | 'other')
  subject_table, subject_id          -- polymorphic link back to source
  title, summary, amount?, currency?
  requested_by, approver_profile_id
  status ('pending'|'approved'|'rejected'|'changes_requested')
  decision_note, decided_at
  due_at?                            -- SLA / deadline
  created_at
```

Existing `key_event_approvals` and PO approvals stay where they are (they have domain fields the generic table shouldn't carry), but they **emit a row into `approvals`** on create/update via trigger. That gives us one queryable surface without a destructive migration.

### 3. Build an "Approvals Inbox"

A new top-level page (`/approvals`) and a Sidebar count badge, showing every pending item where `approver_profile_id = me`, grouped by kind:

```text
Approvals (4 pending)
  Costs (2)        £4,200 — "Off-site catering"      Request: Ash       [Approve][Reject][Comment]
                   £850   — "Figma seats x3"          Request: Priya     [Approve][Reject][Comment]
  Event dates (1)  "Investor update — 14 May"        Request: Nimesh    [Approve][Suggest date]
  Releases (1)     "v2.4 — feature flags off"        Request: Ops       [Approve][Reject]
```

Plus:

- **Filters**: kind, requester, age, amount.
- **Bulk actions** for low-risk items (e.g. approve multiple <£500 costs).
- **SLA chip** when `due_at` is near or past.
- **Slack DM on request + decision** — reuse `notify-event-approval` and generalise it to `notify-approval`.

## What changes for users

- **CEO / approvers**: one inbox, one place to clear, with a Slack ping. No more hunting between Planner, POs and Settings.
- **Requesters**: a "Request approval" action wherever it makes sense — on a PO, on an event, on a release, or standalone for ad-hoc costs.
- **Planner**: stays for *date-bound* sign-offs (launch dates, holidays, comms windows). Cost approvals leave the planner.

## Phasing

1. **Phase 1 — short**: add the `approvals` table + triggers from `key_event_approvals` and `purchase_orders`; build `/approvals` inbox (read-only roll-up, decision still happens in the source module). Generalise the Slack notifier.
2. **Phase 2**: add the lightweight "cost approval" path on PurchaseOrders + a "Request cost sign-off" button on planner events.
3. **Phase 3**: allow decisions directly from the inbox (write back to source rows), bulk approve, SLA badges.

## Open questions before I plan implementation

1. Should the inbox **also let you decide** in-place (Phase 3) from day one, or are you happy with the read-only roll-up first?
2. For ad-hoc cost approvals: keep them in the existing `purchase_orders` table with a `kind` column, or split into a sibling `cost_requests` table? (I'd recommend the former — less surface area.)
3. Approver model — single approver per item (today's model), or do you want **multi-approver** (e.g. dept owner *and* finance both required) for amounts above a threshold?
4. Should approvers see a **weekly digest** ("3 items waiting > 48h") in addition to per-event Slack DMs?

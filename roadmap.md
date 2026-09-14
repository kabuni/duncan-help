# Roadmap

- [x] Fix password reset / login outage handling
- [x] Radical Planner redesign: Duncan-first planning experience
  - [x] Duncan ask panel at top ("What do you need to plan?") with examples
  - [x] Today / Needs attention / Upcoming overview
  - [x] Calm minimal calendar as visual layer
  - [x] Move connection, sync, reconnect, owner + category filters into an Advanced sheet
  - [x] Start Tour kept as secondary action; tour rewritten around talking to Duncan
- [x] Fix /planner/decision-lab admin access (granted Arzoo global admin role; check = useIsAdmin/user_roles)
- [x] Verify main Duncan Chat (/home) uses the same planner orchestration engine as the Decision Lab; report findings, connect if not

## Line manager + approvals
- [x] profiles.line_manager_profile_id + get_line_manager_profile_id()
- [x] Onboarding "Who is your line manager?" step + profile field
- [x] Admin can change a user's line manager (settings)
- [x] Fix: planner event shows "Pending approval" with no approval row — orchestrator must create key_event_approvals routed to line manager, or not mark pending
- [x] Duncan auto-selects the Planner category (existing category list) inside the orchestration decision; no category step in chat; works in chat, Decision Lab and updates
- [x] Approval gate: leave cannot be created unless a real approval request is raised to the current line manager (pre-check + rollback; Google entry marked tentative/[Pending approval])
- [x] Natural-language remove/cancel/find via the shared planner orchestrator

## Projects ↔ Workstream Cards
- [x] Project → Workstreams → Tasks relationship (workstream_cards.project_id, workstream_tasks.project_id)
- [x] Projects list + workspace tabs (Overview, Workstreams, Tasks, Team, Activity, Duncan)
- [ ] Decide: promote an existing Workstream Card into a Project vs create a separate Project and link the card (mockup at /projects/concepts for comparison; no data migrated)

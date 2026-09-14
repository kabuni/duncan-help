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
- [x] Decided: Projects are independent and link multiple Workstream Cards (Option B); "Promote to Project" on a card is a shortcut that creates the project shell and links the same card. Comparison screen removed.

## Environments: build here, ship into production
Production Duncan (https://prod.duncan.kabuni.com) is a SEPARATE backend holding the real
workstream_cards / workstream_tasks (WS-0104, WS-0252, WS-0274, WS-0290, WS-0292, WS-0299 ...).
This Lovable environment (Supabase ref rfwvemsjwytxxhwowpqh, same instance for preview and
duncan-help.lovable.app) has its own unrelated cards WS-0001..WS-0053.

Rules:
- [x] Never copy, migrate, duplicate or recreate production cards here
- [x] Never create mock/demo Workstream Cards to stand in for production data
- [x] Build the Projects experience against the shared data model only (workstream_cards,
      workstream_tasks, workstream_activity, profiles, projects, project_members)
- [ ] Deploy the Projects feature into production later; production cards stay source of truth

### Production deployment checklist (additive, non-destructive — run there, not here)
1. Tables that must exist in production: `projects`, `project_members`, `project_messages`
   (with author_type / nullable user_id), plus RLS + GRANTs and `can_access_project()` /
   `is_project_member()` security-definer functions.
2. Additive columns only — no rewrites of existing rows:
   - `workstream_cards.project_id uuid null references projects(id) on delete set null`
   - `workstream_tasks.project_id uuid null references projects(id) on delete set null`
   Both default NULL, so every existing card/task keeps its WS ID, owner, status, due date,
   tasks, completion history and activity untouched and continues to work standalone.
3. Deploy edge function `project-team-duncan`.
4. Ship the UI: Projects list, ProjectWorkspace (Overview / Team Chat / Areas of Work /
   Activity), AreaOfWorkDrawer, PromoteToProjectAction, useProjectWork.
5. Mapping is a data step done in production by linking (setting project_id on) existing
   cards — never by inserting new cards:
   WS-0299 → Kabuni School Premier League; WS-0290 → Founder Story + Social;
   WS-0274 → K10 App; WS-0292 → Cricket MVP App; WS-0252 → Road to 400; WS-0104 → Duncan AI.
   WS-0297 (Done) left unmapped and preserved. Unclear cards left unmapped.
6. Reversible: clearing project_id detaches a card with zero data loss.

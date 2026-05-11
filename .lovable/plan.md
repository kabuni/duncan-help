## Problem

`/operations` is a fully working route (`src/pages/Operations.tsx`, registered in `App.tsx`), but the sidebar in `src/components/Sidebar.tsx` has no link to it. The only way in today is a small text button on the Home dashboard, which is easy to miss — so on duncan.help it feels like Operations is unreachable.

## Fix

Add an "Operations" entry to the sidebar nav, matching the styling of the existing items (Dashboard, Projects, Workstreams, Planner, Approvals, Authorisation Requests).

- File: `src/components/Sidebar.tsx`
- Place it after **Authorisation Requests** and before **Team Briefing**, so finance/ops items group together.
- Use the existing `GitBranch` icon (already imported) or `LayoutDashboard`-style lucide icon — propose `GitBranch` since Operations is DevOps-centric (matches the AzureDevOps integration label already using it).
- Same `RouterNavLink` pattern with active-state classes used by the other nav items.
- Closes the mobile drawer on click via `onMobileClose?.()`.

No backend, route, or permission changes needed — the route and page already exist and work.

## Out of scope

- No changes to the Operations page itself.
- No role-gating (current behavior keeps it visible to all signed-in users, same as today via the Home button).

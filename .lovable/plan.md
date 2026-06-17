## Goal
Arzoo (`arzoo@kabuni.com`) should have admin powers **only within recruitment** — not global admin (no user approvals, no integrations management, no purchase orders, no CEO briefing, etc.).

## Current state
She was granted the global `admin` role in `user_roles`, which gates everything via `has_role(uid, 'admin')` across the whole app (Settings → User Management, Integrations, POs, deletions, etc.). That's too broad.

## Approach
Introduce a **recruitment-scoped admin** capability without giving global admin.

### 1. Database
- Remove Arzoo's `admin` row from `user_roles`.
- Add a new value `'recruitment_admin'` to the `app_role` enum.
- Insert `('arzoo-uid', 'recruitment_admin')` into `user_roles`.
- Update RLS on recruitment tables so both `admin` and `recruitment_admin` qualify:
  - `job_roles` — "Admins can manage job roles" policy → `has_role(uid,'admin') OR has_role(uid,'recruitment_admin')`
  - `candidates` — "Admins can delete candidates" policy → same OR
  - `hireflix_retry_queue` admin-gated policies (if any) → same OR
- Leave every other table's `has_role(uid,'admin')` policy untouched, so she cannot manage users, integrations, POs, etc.

### 2. Frontend
- Add a `useIsRecruitmentAdmin()` hook (mirrors `useIsAdmin`) querying `user_roles` for `recruitment_admin` OR global `admin`.
- No other UI changes required — the Recruitment page is already visible to all authenticated users, and the destructive actions (delete role, delete candidate, close role) are guarded by RLS, which will now permit her.
- Confirm Settings → Account Approvals / User Management / Workspace Welcome remain hidden for her (they check `useIsAdmin`, which will return false).

### 3. Memory
Save a project memory noting the new `recruitment_admin` scoped role and that Arzoo holds it (not global admin), so future RBAC work doesn't accidentally elevate her.

## Out of scope
- No changes to the recruitment UI itself (close/reopen toggle already shipped).
- No changes to other scoped roles (we're only introducing `recruitment_admin` for now).

## Confirm before I build
1. OK to add a new enum value `recruitment_admin` (vs. e.g. a separate `recruitment_permissions` table)?
2. Should `recruitment_admin` also be able to **delete candidates** and **delete job roles**, or only close/reopen + manage CVs/invites?

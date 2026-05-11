## Hide Operations from Sidebar for Non-Admins

### Goal
Conditionally show the **Operations** nav link in the sidebar only for users with the `admin` role.

### Changes
1. **`src/components/Sidebar.tsx`**
   - Import `useIsAdmin` from `@/hooks/useUserRoles`.
   - Call `useIsAdmin()` inside the `Sidebar` component.
   - Wrap the existing `/operations` `RouterNavLink` in `{isAdmin && (...)}` so it renders only for admins.
   - While `isLoading` is true, keep the link visible (to avoid layout flicker / disappearance after load).

### Technical Detail
- `useIsAdmin` queries `user_roles` table and returns `isAdmin: boolean`.
- The sidebar already uses similar conditional rendering for `canViewBriefing` (Team Briefing link).
- The `/operations` route itself remains accessible directly via URL for anyone who bookmarks it; this change only affects sidebar visibility.

### No Other Changes
- No backend, RLS, or route-guard changes needed.
- No impact on mobile vs desktop sidebar logic.
## Goals

1. **Chat UI** – stop showing only Duncan's avatar. Render the current user's avatar/initials and name on their own messages so it's clear who is talking.
2. **Mobile responsiveness** – tighten the layouts on pages that currently feel cramped, scroll horizontally, or have controls that overflow on phone-sized viewports.

---

## Part 1 — Chat: show "who is talking"

### Affected files
- `src/pages/Index.tsx` (main Duncan chat — `MessageBubble`)
- `src/pages/ProjectWorkspace.tsx` (project chat messages)

### Changes
- Pull `profile` (display_name, avatar_url) from `useProfile()` in both chat surfaces.
- For **user messages**, render an avatar on the right side, mirroring the Duncan avatar pattern:
  - Use shadcn `Avatar` + `AvatarImage` (from `profile.avatar_url`) with `AvatarFallback` showing initials of `display_name` (or "Me" if missing).
  - Same 28px circle, border, spacing as the Duncan avatar — just placed to the right of the bubble when `role === "user"`.
- Above each bubble (both Duncan and user) show a small sender label:
  - `"Duncan"` for assistant messages.
  - `profile.display_name || "You"` for user messages.
  - Reuse the existing `senderNameFor` pattern that ProjectWorkspace already has, but extend it to the main chat (which currently has no sender label at all).
- Keep the existing alignment (user right, assistant left) and bubble colors unchanged.

### Result
Each turn clearly shows who said what:
```
[Duncan avatar]  Duncan
                 Lorem ipsum…
                                              You / Display Name [User avatar]
                                              Hi Duncan, can you…
```

---

## Part 2 — Mobile responsiveness pass

Audit shows several pages have very few responsive utilities and break on ≤414px widths. Targeted fixes:

### `src/pages/Recruitment.tsx` (worst offender — 976 lines, almost no `sm:` classes)
- Wrap the candidates table in `overflow-x-auto` with `min-w-[640px]` so it scrolls instead of squishing.
- Stack the page header (title + filters + buttons) vertically on mobile (`flex-col sm:flex-row`, `gap-2`).
- Reduce header padding on mobile (`px-3 sm:px-6`, `py-3 sm:py-4`).
- Make role-tab buttons horizontally scrollable (`flex overflow-x-auto scrollbar-thin` + `whitespace-nowrap`).

### `src/pages/Operations.tsx`
- Convert KPI/stat grids from fixed columns to `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4`.
- Tables: wrap in `overflow-x-auto`, set `min-w-[600px]`.
- Header: stack title + sync button vertically on mobile.

### `src/pages/PurchaseOrders.tsx`, `src/pages/Workstreams.tsx`, `src/pages/ReleaseManager.tsx`, `src/pages/WhatsNew.tsx`, `src/pages/Profile.tsx`, `src/pages/Settings.tsx`, `src/pages/FeedbackIssues.tsx`, `src/pages/Integrations.tsx`, `src/pages/Gmail.tsx`
For each: do a focused responsiveness pass:
- Page container padding → `px-3 sm:px-6 lg:px-8`, `py-4 sm:py-6`.
- Header rows → `flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-4`.
- Card grids → `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3` (instead of fixed multi-column).
- Tables/wide content → wrap in `overflow-x-auto` with sensible `min-w-[…]`.
- Long button rows → `flex-wrap` so they wrap instead of overflowing.
- Hide secondary text/labels on `<sm` where space-constrained (e.g. `<span className="hidden sm:inline">`).
- Reduce font sizes one step on mobile where headings overflow (e.g. `text-2xl sm:text-3xl`).

### Shared components touched
- `src/components/po/POList.tsx`, `src/components/po/POForm.tsx`, `src/components/recruitment/JobRolesManager.tsx`, `src/components/workstreams/KanbanBoard.tsx` — same pattern: stack on mobile, wrap tables in scroll containers, allow buttons to wrap.

### Out of scope
- No changes to the Sidebar (already mobile-aware via `AppLayout`'s `MobileMenuButton`).
- No visual redesign — just responsive utility tweaks. Desktop appearance unchanged.
- No backend or data changes.

---

## Verification
After implementation:
- Open `/`, `/recruitment`, `/operations`, `/workstreams`, `/purchase-orders`, `/integrations`, `/whats-new`, `/settings`, `/profile`, `/feedback`, `/gmail`, `/release-manager` at 375×812 (iPhone) and confirm:
  - No horizontal page scroll.
  - Headers + buttons wrap cleanly.
  - Tables scroll inside their containers, not the whole page.
- Send a chat message on `/` and inside a project chat → confirm the user's avatar and name appear on the right, Duncan's on the left.

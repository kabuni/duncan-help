## Problem

On the Home page, the `ChatInput` composer is rendered as the last flex child of `<main>` in `src/pages/Index.tsx`, but the page root uses `h-full` inside an `AppLayout` wrapper whose column uses `min-h-dvh` (not a fixed height). Because `height: 100%` only resolves against a parent with a defined height (not `min-height`), the Home page effectively grows with its content instead of being viewport-capped. Result: the `PersonalBriefingDashboard` pushes the composer below the fold, forcing the user to scroll to reach it.

## Fix (scope: frontend only, Home page)

Constrain the Home page to the viewport height so the internal content area (`scrollRef` div with `overflow-y-auto`) scrolls, and the `ChatInput` naturally stays pinned at the bottom of the viewport.

### Change

In `src/pages/Index.tsx`, update the root wrapper of the Home page:

```tsx
// before
<div className="flex h-full bg-background">

// after
<div className="flex h-dvh bg-background">
```

This gives the flex column a real, viewport-bound height. The existing structure already does the right thing once height is bounded:
- Header (fixed content)
- Briefing banners (fixed content)
- `scrollRef` content area with `flex-1 overflow-y-auto` (scrolls internally)
- `ChatInput` (always visible at the bottom)

No other files need to change. `AppLayout` continues to use `min-h-dvh` for other routes, so this fix is isolated to Home.

### Verification

- On desktop and mobile, load `/`: composer visible at the bottom without scrolling, dashboard scrolls inside the middle region.
- Send a message: transcript scrolls internally, composer remains pinned.
- Mobile safe-area insets on `AppLayout` still apply (bottom padding preserved).
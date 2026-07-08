
# Interactive Onboarding & Training System

Goal: an in-product, spotlight-and-tooltip walkthrough system (Notion/Linear/ClickUp style) integrated with Learn Duncan, with per-user persistence, replay, and dedicated tutorials for Projects, Workstreams, and Planner.

## 1. Codebase Audit (what's there today)

- Existing "Meet Duncan" tour (`src/components/onboarding/MeetDuncanTour.tsx`) is a **modal carousel** — no element highlighting. Completion tracked via `profiles.meet_duncan_tour_completed_at`. Replay wired in `src/pages/Learn.tsx`.
- `Learn.tsx` renders `MODULES` cards from `src/components/onboarding/moduleContent.ts`. No progress/status/tutorial concept.
- Target pages exist and are small enough to instrument: `Projects.tsx` (145), `Workstreams.tsx` (548), `KeyEventsDiary.tsx` (666), `Sidebar.tsx`.
- **No** existing selectors/`data-*` attributes for tour targeting; **no** tour library installed.
- Profile already has `dismissed_nudges jsonb` used for nudge state — reusable pattern for tutorial state.

## 2. Architecture

### 2a. Library choice
Build a lightweight **custom** tour engine (~250 LoC) rather than pulling in Shepherd/driver.js/reactour. Reasons: existing framer-motion + Duncan styling already in the modal tour; full control over spotlight, mobile, and Duncan look; no extra dependency, no CSS injection conflicts with Tailwind tokens.

Engine responsibilities:
- Resolve targets by `data-tour="<id>"` attribute (stable, decoupled from class names).
- Compute target bounding rect on scroll/resize; render SVG overlay with a cut-out (spotlight).
- Position tooltip using floating placement (top/bottom/left/right auto-flip). No new dep — small utility.
- Navigation (Next / Back / Skip / Close), progress ("Step X of Y"), waitForElement (polls up to N ms so steps can advance after user clicks).
- Optional `action: 'click' | 'wait'` per step; optional `route: '/projects'` to navigate before the step.

### 2b. Files to add
```
src/components/onboarding/tour/
  TourProvider.tsx      # context + state machine + persistence
  TourOverlay.tsx       # spotlight SVG + tooltip renderer
  useTour.ts            # hook: start(id) / resume(id) / stop / next / back
  tours.ts              # tour definitions (projects, workstreams, planner)
  types.ts
src/components/onboarding/TutorialsSection.tsx  # Learn Duncan tutorials grid
src/hooks/useTutorialProgress.ts               # per-user progress read/write
```

### 2c. Persistence
Single JSONB column on `profiles`: `tutorial_progress jsonb default '{}'`.
Shape:
```json
{
  "projects":    { "status":"in_progress","step":3,"total":10,"updated_at":"...","completed_at":null },
  "workstreams": { "status":"completed","step":11,"total":11,"updated_at":"...","completed_at":"..." },
  "planner":     { "status":"not_started","step":0,"total":8 }
}
```
One migration: add column + default. No new table.

### 2d. First-time detection
User is "first-time" for a tour if `tutorial_progress[id]` is missing/`not_started` **and** `meet_duncan_tour_completed_at` is set (so the existing Meet Duncan modal runs first, then the interactive walkthroughs start when they land on the module page). On first visit to `/projects`, `/workstreams`, `/diary`, auto-start the corresponding tour once. Never auto-start again after skip/complete.

### 2e. Replay buttons
Small `<TutorialButton tourId="projects" />` component (icon + "Replay tour") wired into the page header of Projects, Workstreams, Planner. Same component used in Learn Duncan card actions.

## 3. UI Instrumentation (data-tour targets)

Only additive changes — add `data-tour="…"` on existing elements.

**Sidebar:** `nav-projects`, `nav-workstreams`, `nav-diary`, `nav-learn`.

**Projects (`Projects.tsx`):** `projects-new`, `projects-list`, `projects-card` (first card), `projects-search` (if present).

**ProjectWorkspace:** `project-notes-tab`, `project-tasks-tab`, `project-files-tab`, `project-new-note`, `project-new-task`, `project-collab`, `project-delete`.

**Workstreams (`Workstreams.tsx` / `KanbanBoard.tsx`):** `ws-new-card`, `ws-column-todo`, `ws-card` (first), `ws-presentation-toggle`, `ws-project-filter`.

**CardDetailModal:** `card-title`, `card-status`, `card-assignees`, `card-tasks`, `card-subtasks`, `card-comments`, `card-attachments`, `card-tags`.

**Planner (`KeyEventsDiary.tsx`):** `planner-view-toggle`, `planner-new-event`, `planner-event` (first), `planner-google-sync`, `planner-key-events-filter`.

Any target that's rendered conditionally (modal contents) is handled by the engine's `waitForElement` polling.

## 4. Tutorial Definitions

Each step: `{ target, title, body, placement?, action?, route?, onBefore? }`.

- **Projects (10 steps)** — Sidebar → Projects → New Project button → Create dialog fields → open project → Notes tab → New Note → Tasks tab → New Task → Files/Upload → Collaboration → Delete.
- **Workstreams (11 steps)** — Sidebar → New Card → open card → Title/Status → Assignees → Tasks → Subtasks → Comments → Attachments → Project tag → Presentation view.
- **Planner (8 steps)** — Sidebar → View toggle (day/week/month) → New Event → Edit event → Delete → Key Events highlight → Google Calendar sync banner → Ownership rules note.

Steps mixing narration + a real click use `action:'click'` (advances when user actually clicks the highlighted element) with a "Skip step" affordance so users never feel trapped.

## 5. User Journeys

### First-time user
1. Signs in → Meet Duncan modal runs (existing).
2. Lands on Home → Getting Started card visible (existing).
3. Navigates to Projects → tour auto-starts (once). Spotlight + tooltip guide through 10 steps.
4. On completion, `tutorial_progress.projects = completed`. Same auto-start on first visit to Workstreams and Planner.
5. Learn Duncan shows all three as ✓ Completed with dates.

### Returning user
- No auto-start. Tutorials sit in Learn Duncan with current status (Not started / In progress X% / Completed on Y).
- Replay button in each page header always available.

### Replay flow
Click Replay → progress reset for that tour → engine starts at step 1, navigates to correct route if needed.

### Resume flow
If user closes mid-tour (not "Skip"), status stays `in_progress` with `step`. Next time they open the page or click "Resume" in Learn Duncan, engine offers "Resume from step N / Restart / Cancel".

### Skip flow
"Skip tutorial" marks it `skipped` (treated like completed for auto-start suppression), replay still available.

## 6. Technical Details

**Overlay implementation**
- Full-viewport `<svg>` with a mask: a full rect minus a rounded rect around the target's bounding box (with 8px padding). Backdrop `bg-background/70`.
- Tooltip is a positioned `div` (fixed) placed relative to target rect with 12px offset and 8px viewport padding; auto-flips placement.
- Recomputes on `resize`, `scroll` (capture), and every 200ms while active (handles animated layouts).
- Click-through disabled by default; when `action:'click'`, the spotlight area becomes click-through and the engine listens for the target's `click`.

**Route handling**
Steps may declare `route`. Engine uses `useNavigate`; waits for pathname match and target element before displaying.

**Persistence writes**
Debounced 500ms updates to `profiles.tutorial_progress` via `supabase.from('profiles').update({tutorial_progress: {...}})`. Optimistic local cache in `TourProvider`.

**Learn Duncan section**
New `TutorialsSection` above the existing modules grid:
- Card per tutorial: name, description, ETA ("~3 min"), status pill, last completed date, progress bar, action button (Start/Resume/Replay).
- Renders tour registry from `tours.ts` — no hardcoded duplication.

**Mobile**
- Tooltip max-width `min(320px, 92vw)`, positioned bottom when target is in top half, else top.
- Spotlight padding shrinks on small screens.

## 7. Migration

```sql
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS tutorial_progress jsonb NOT NULL DEFAULT '{}'::jsonb;
```
No new grants/policies needed (existing profile RLS covers it).

## 8. Out of Scope (v1)

- Cross-device real-time sync of in-progress step (writes are async but not realtime).
- Analytics on tutorial funnel (can layer on later via existing token/usage tracking pattern).
- Tutorials for modules other than Projects, Workstreams, Planner.

## 9. Delivery Order

1. Migration (`tutorial_progress` column).
2. Tour engine (`TourProvider`, `TourOverlay`, `useTour`, `types`).
3. `useTutorialProgress` hook + `TutorialButton`.
4. Instrument Sidebar + target pages with `data-tour` attributes (additive only).
5. Author `tours.ts` for Projects, Workstreams, Planner.
6. `TutorialsSection` + integrate into `Learn.tsx`.
7. Wire auto-start on first visit to each module page.
8. QA on desktop + mobile viewports.

Estimated: single implementation pass, no schema risk, isolated from business logic.

---
**Approve to proceed** and I'll implement in the order above.
